import * as vscode from 'vscode';
import axios from 'axios';
import { existsSync, mkdir, mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import * as os from 'os';


export function activate(context: vscode.ExtensionContext) {
	const provider = new MistralChatViewProvider(context.extensionUri);
	const exportAsJSONCommand = 'mistral-vscode.exportChatJSON';

	const exportChatAsJSON = () => {
		provider.exportChatAsJSON();
	};

	// register our custom webview provider
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(MistralChatViewProvider.viewType, provider)
	);

	// register commands
	context.subscriptions.push(
		vscode.commands.registerCommand(exportAsJSONCommand, exportChatAsJSON)
	);
}

export function deactivate() {}


class MistralChatViewProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = 'mistral-vscode.mistralChatView';

	private _view?: vscode.WebviewView;
	private currentChat?: Object[] = [];
	private _config = vscode.workspace.getConfiguration('mistral-vscode');

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
						webviewView.webview.postMessage({ command: 'messageReceived' });
						this._getStreamedAnswerFromMistralAPI(data.chat, data.model);
						return;
					}
				case 'saveChat':
					{
						if (!this._config.mustSaveChats) { return; }

						let saveChatsLocation = '';
						let defaultVal = '';
						if (os.platform() === 'win32') {
							defaultVal = '%USERPROFILE%';
						}
						saveChatsLocation = path.resolve(this._config.saveChatsLocation.replace(/^~/, os.userInfo().homedir || defaultVal));

						// Create the chat logs directory if required
						if (!existsSync(saveChatsLocation)) {
							mkdirSync(saveChatsLocation, { recursive: true });
						}

						// Write log file
						const logFilePath = path.join(saveChatsLocation, `${data.chatID}.log`);
						writeFileSync(logFilePath, data.contents);
						return;
					}
				case 'didExportChatAsJSON':
					{
						vscode.window.showSaveDialog({ title: "Save chat session as JSON", filters: { 'JSON': ['json'] } }).then(fileInfos => {
							if (fileInfos) {
								writeFileSync(fileInfos.fsPath, data.contents);
							}
						});
						return;
					}
			}
		});
	}

	public exportChatAsJSON() {
		const webview = this._view?.webview;
		webview?.postMessage({ command: 'getChatAsJSON' });
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
		const defaultModel = this._config.defaultModel;

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
				window.defaultModel = "${defaultModel}";
				window.loadingSvgUri = "${loadingSvgUri}";
			</script>

			<title>Mistral Chat</title>
		</head>
		<body>
			<div id="chat" class="chat-container"></div>
			<div class="input-container">
				<textarea id="messageInput" placeholder="Type your message here..."></textarea>
				<button id="sendButton">Send</button>
				<div class="model-selector">
					<span id="modelCog" class="cog-icon">⚙️</span>
					<div id="modelTooltip" class="tooltip">
						<span><b>Active model</b></span>
						<ul>
							<li class="modelSelector" data-model="mistral-tiny">mistral-tiny</li>
							<li class="modelSelector" data-model="mistral-small">mistral-small</li>
							<li class="modelSelector" data-model="mistral-medium">mistral-medium</li>
						</ul>
					</div>
				</div>
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
