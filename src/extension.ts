import * as vscode from 'vscode';
import axios from 'axios';


export function activate(context: vscode.ExtensionContext) {
	const provider = new MistralChatViewProvider(context.extensionUri);

	// register our custom webview provider
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(MistralChatViewProvider.viewType, provider)
	);
		
	async function promptAndGetAnswer(model?: string) {
		const prompt = await vscode.window.showInputBox( { placeHolder: "Ask Mistral AI..." });

		if (!model) {
			model = vscode.workspace.getConfiguration('mistral-vscode').defaultModel;
		}

		if (prompt) {
			try {
				let doc = await vscode.workspace.openTextDocument({
					language: 'plaintext',
					content: `[QUESTION]\n${prompt}\n\n[MISTRAL] (${model})\n`
				});
				let editor = await vscode.window.showTextDocument(doc, { preview: false });

				getAnswerFromMistralAPI(prompt, (content) => {
					editor.edit((editBuilder) => {
						const lastLine = editor.document.lineAt(editor.document.lineCount - 1);
						const lastLineEnd = lastLine.range.end;
						editBuilder.insert(lastLineEnd, content);
					});
				}, model);
			} catch (error) {
				vscode.window.showErrorMessage("Error fetching answer from Mistral API: " + String(error));
			}
		}
	};

	let disposable = vscode.commands.registerCommand('mistral-vscode.askmistral', async () => {
		promptAndGetAnswer();
	});

	let full = vscode.commands.registerCommand('mistral-vscode.askmistral-model', async () => {
		const model = await vscode.window.showQuickPick(
			[
				"mistral-tiny",
				"mistral-small",
				"mistral-medium"
			],
			{
				canPickMany: false,
				placeHolder: "Select the Mistral model to use",
				title: "Mistral AI Model"
			}
		);

		promptAndGetAnswer(model);
	});

	context.subscriptions.push(disposable);
	context.subscriptions.push(full);
}


async function getAnswerFromMistralAPI(question: string, updateContent: (content: string) => void, model?: string) {
	const apiUrl = 'https://api.mistral.ai/v1/chat/completions';
	const modelToUse = model || vscode.workspace.getConfiguration('mistral-vscode').defaultModel;
	const apiKey = vscode.workspace.getConfiguration('mistral-vscode').apiKey;

	if (!modelToUse) {
		throw new Error("Model not specified. Please provide a model as a parameter or set a default model in the extension settings.");
	}

	const response = await axios.post(
		apiUrl,
		{
			model: modelToUse,
			messages: [
				{ role: "user", content: question }
			],
			stream: true
		},
		{
			headers: { 'Authorization': `Bearer ${apiKey}` },
			responseType: 'stream'
		},
	);

	const stream = response.data;

	stream.on('data', (chunk: any) => {
		const items = chunk.toString().split('data: ');

		items.forEach((item: string) => {
			try {
				if (item.trim() === '[DONE]') {
					return;
				}
				if (item.trim()) {
					const jsonData = JSON.parse(item.trim());
					if (jsonData && jsonData.object && jsonData.object === 'chat.completion.chunk') {
						if (jsonData && jsonData.choices) {
							updateContent(jsonData.choices[0].delta.content);
						}
					}
				}
			} catch (error) {
				console.error("Error parsing item: ", error);
			}
		});
	});
}

async function getFullAnswerFromMistralAPI(question: string, model?: string) {
	const apiUrl = 'https://api.mistral.ai/v1/chat/completions';
	const modelToUse = model || vscode.workspace.getConfiguration('mistral-vscode').preferredModel;
	const apiKey = vscode.workspace.getConfiguration('mistral-vscode').apiKey;

	if (!modelToUse) {
		throw new Error("Model not specified. Please provide a model as a parameter or set a default model in the extension settings.");
	}

	const response = await axios.post(
		apiUrl,
		{
			model: modelToUse,
			messages: [
				{ role: "user", content: question }
			],
		},
		{
			headers: { 'Authorization': `Bearer ${apiKey}` },
		},
	);

	if (response.status === 200) {
		const answer = response.data.choices[0].message.content;
		return answer;
	} else {
		vscode.window.showErrorMessage("Mistral API returned with error code " + response.status);
	}
}


export function deactivate() {}


class MistralChatViewProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = 'mistral-vscode.mistralChatView';

	private _view?: vscode.WebviewView;

	constructor(
		private readonly _extensionUri: vscode.Uri,
	) { }

	public resolveWebviewView(
		webviewView: vscode.WebviewView,
		context: vscode.WebviewViewResolveContext<unknown>,
		token: vscode.CancellationToken
	): void | Thenable<void> {
		this._view = webviewView;

		webviewView.webview.options = {
			enableScripts: true,

			localResourceRoots: [
				this._extensionUri,
			]
		};

		webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

		webviewView.webview.onDidReceiveMessage(async (data) => {
			switch (data.command) {
				case 'sendMessage':
					{
						webviewView.webview.postMessage({ command: 'newMessage' });
						const response = this._getStreamedAnswerFromMistralAPI(data.chat);
						return;
					}
			}
		});
	}

	private async _getStreamedAnswerFromMistralAPI(chat: Object, model?: string) {
		const webview = this._view?.webview;
		const apiUrl = 'https://api.mistral.ai/v1/chat/completions';
		const modelToUse = model || vscode.workspace.getConfiguration('mistral-vscode').preferredModel;
		const apiKey = vscode.workspace.getConfiguration('mistral-vscode').apiKey;

		if (!modelToUse) {
			throw new Error("Model not specified. Please provide a model or set a default value in the extension settings.");
		}

		const response = await axios.post(
			apiUrl,
			{
				model: modelToUse,
				messages: chat,
				stream: true
			},
			{
				headers: { 'Authorization': `Bearer ${apiKey}` },
				responseType: 'stream'
			}
		);

		const stream = response.data;

		stream.on('data', (chunk: any) => {
			const items = chunk.toString().split('data: ');

			items.forEach((item: string) => {
				try {
					if (item.trim() === '[DONE]') {
						webview?.postMessage({ command: 'endSession' });
						return;
					}
					if (item.trim()) {
						const jsonData = JSON.parse(item.trim());
						if (jsonData && jsonData.object && jsonData.object === 'chat.completion.chunk') {
							if (jsonData && jsonData.choices) {
								webview?.postMessage({ command: 'newChunk', text: jsonData.choices[0].delta.content });
							}
						}
					}
				} catch (error) {
					console.error("Error parsing item: ", error);
				}
			});
		});
	}

	private _getHtmlForWebview(webview: vscode.Webview): string {
		const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'main.js'));
		const styleMainUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'main.css'));
		const loadingSvgUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'loading.svg'));

		const highlightJsStyleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'highlightjs', 'styles', 'atom-one-dark.min.css'));
		const highlightJsUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'highlightjs', 'highlight.min.js'));
		const nonce = getNonce();

		return `<!DOCTYPE html>
		<html lang="en">
		<head>
			<meta charset="UTF-8">

			<!--
				Use a content security policy to only allow loading images from https or from our extension directory,
				and only allow scripts that have a specific nonce.
			-->
			<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; img-src ${webview.cspSource} https:; script-src 'nonce-${nonce}';">
			<meta name="viewport" content="width=device-width, initial-scale=1.0">

			<link href="${styleMainUri}" rel="stylesheet">
			<link href="${highlightJsStyleUri}" rel="stylesheet">
			<script nonce="${nonce}" src="${highlightJsUri}"></script>
			<script nonce="${nonce}">
				window.loadingSvgUri = "${loadingSvgUri}";
			</script>

			<title>Mistral Chat</title>
		</head>
		<body>
			<div id="chat" class="chat-container"></div>
			<div class="input-container">
				<textarea id="messageInput" placeholder="Type your message here..."></textarea>
				<button id="sendButton">Send</button>
			</div>

			<script nonce="${nonce}" src="${scriptUri}"></script>
		</body>
		</html>
	`;
	}
}

function getNonce() {
	let text = '';
	const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}
