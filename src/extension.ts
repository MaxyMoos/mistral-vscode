import * as vscode from 'vscode';
import axios from 'axios';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import * as os from 'os';


const MISTRAL_CHAT_COMPLETION_URL = 'https://api.mistral.ai/v1/chat/completions';


export function activate(context: vscode.ExtensionContext) {
	const provider = new MistralChatViewProvider(context.extensionUri);
	const openChatCommand = 'mistral-vscode.openChat';
	const startNewChatCommand = 'mistral-vscode.startNewChat';

	const openChat = () => {
		provider.openChat();
	};

	const startNewChat = () => {
		provider.startNewChat();
	};

	// register our custom webview provider
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(MistralChatViewProvider.viewType, provider)
	);

	// register commands
	context.subscriptions.push(
		vscode.commands.registerCommand(openChatCommand, openChat),
		vscode.commands.registerCommand(startNewChatCommand, startNewChat),
	);
}

export function deactivate() {}


class MistralChatViewProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = 'mistral-vscode.mistralChatView';

	private _view?: vscode.WebviewView;
	private _config = vscode.workspace.getConfiguration('mistral-vscode');

	constructor(
		private readonly _extensionUri: vscode.Uri,
	) { }

	private getSavedChatsLocation() {
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

		return saveChatsLocation;
	}

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
						// If necessary, get Mistral to summarize the chat into a "Chat Title"
						if (data.chat.length === 1 && this._config.getChatsTitlesByMistral) {
							let getTitleRequestChat = [
								{ role: "system", content: "You are a masterful assistant that extracts a general topic from a request sent by the user into a very short sequence of words.\nIt is very important that the output is in 7 WORDS OR LESS. The output must not contain characters that would prevent it from being used as a filename on Windows/MacOS or Linux environments. Your answer must ONLY contain ONE summary, NO alternative propositions, NO notes, NO addendum."},
								{ role: "user", content: `${data.chat[0].content}`}
							];
							let chatTitle = await this._getFullAnswerFromMistralAPI(getTitleRequestChat);
							chatTitle = stringToValidFilename(chatTitle);
							this._view?.webview.postMessage({ command: 'setChatTitle', title: chatTitle });
						}

						webviewView.webview.postMessage({ command: 'messageReceived' });
						this._getStreamedAnswerFromMistralAPI(data.chat, data.model);

						return;
					}
				case 'saveChat':
					{
						if (!this._config.mustSaveChats) { return; }

						let saveChatsLocation = this.getSavedChatsLocation();
						// Create the chat logs directory if required
						if (!existsSync(saveChatsLocation)) {
							mkdirSync(saveChatsLocation, { recursive: true });
						}

						// Write log file
						let logFilePath = undefined;
						if (this._config.getChatsTitlesByMistral && data.chatTitle.length > 0) {
							logFilePath = path.join(saveChatsLocation, `${data.chatTitle}.json`);
						} else {
							logFilePath = path.join(saveChatsLocation, `${data.chatID}.json`);
						}
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

	/*
	 * Lets the user select a previous chat JSON file to restore the chat session
	 */
	public openChat() {
		let saveChatsLocation = this.getSavedChatsLocation();

		if (!existsSync(saveChatsLocation)) {
			mkdirSync(saveChatsLocation, { recursive: true });
		}
		
		vscode.window.showOpenDialog(
			{
				defaultUri: vscode.Uri.file(saveChatsLocation),
				canSelectFiles: true,
				canSelectFolders: false,
				canSelectMany: false,
				filters: {
					"JSON": ['json']
				},
				title: "Open a previous chat"
			}
		).then(fileInfos => {
			if (fileInfos?.length) {
				let selectedFile = fileInfos[0];
				let filenameWithExtension = path.basename(selectedFile.fsPath);
				let filenameWithoutExtension = filenameWithExtension.replace(/\.[^/.]+$/, "");
				let contents = readFileSync(selectedFile.fsPath);
				let jsonContents = JSON.parse(contents.toString());
				jsonContents.chatID = filenameWithoutExtension;
				this._view?.webview.postMessage({ command: 'openChat', data: jsonContents });
			}
		});
		return;	
	}

	public startNewChat() {
		const webview = this._view?.webview;
		webview?.postMessage({ command: 'startNewChat' });
	}

	/*
	 * Retrieves an answer from the Mistral API based on the provided chat input.
	 * This method *awaits* for the entire response from the Mistral API before returning.
	 * The API key & model to use are retrieved from the extension configuration.
	 */
	private async _getFullAnswerFromMistralAPI(chat: Object) {
		const apiKey = this._config.apiKey;
		const modelToUse = this._config.chatsTitlesModel;

		if (!modelToUse) {
			throw new Error("Model not specified");
		}

		try {
			const response = await axios.post(
				MISTRAL_CHAT_COMPLETION_URL,
				{
					model: modelToUse,
					messages: chat,
				},
				{ headers: { 'Authorization': `Bearer ${apiKey}` } }
			);
			return response.data.choices[0].message.content;
		} catch (error: unknown) {
			if (axios.isAxiosError(error)) {
				if (error.response) {
					// request was made and the server answered with a status code outside of 2xx
					vscode.window.showErrorMessage("Mistral API answered with HTTP code " + error.response.status);
					console.log(error.response);
				} else if (error.request) {
					// request was made but no response received
					vscode.window.showErrorMessage("No response received from server.");
					console.log(error.request);
				} else {
					// request couldn't even be built & sent
					console.log(error.message);
				}
				console.log(error.toJSON());
			}
		}
	}

	/**
	 * Asynchronously retrieves streamed answers from the Mistral API based on the provided chat input
	 * and model configuration. This method sends a chat object to the Mistral API and listens for streamed
	 * responses. It processes these responses in real-time and updates the webview with new content as it arrives.
	 * 
	 * The method supports streaming by keeping an open connection to the Mistral API and continuously reading
	 * data as it is sent. It handles stream data in chunks, ensuring that partial data can be accumulated and
	 * processed correctly.
	 * 
	 * Process:
	 * 1. Constructs the API URL and headers, including the authorization token.
	 * 2. Validates the provided model or uses a default model from the extension's configuration.
	 * 3. Initiates a POST request to the Mistral API with the chat input, specifying that the response
	 *    should be streamed.
	 * 4. Listens for data chunks from the response stream. Chunks are accumulated in a buffer and processed
	 *    to handle potentially incomplete JSON objects.
	 * 5. Each complete JSON object is parsed and used to update the webview with new content, such as the
	 *    chat completion chunks.
	 * 6. Special markers (e.g., '[DONE]') in the stream indicate the end of the session, triggering cleanup
	 *    and termination of the stream processing.
	 * 
	 * This method utilizes error handling to manage parsing errors and ensures that partial data is not
	 * discarded prematurely, allowing for the accumulation of data until a complete and valid JSON object
	 * can be formed and processed.
	 * 
	 * The use of a buffer to accumulate data chunks is a key aspect of handling streamed responses, especially
	 * when dealing with JSON data that may be split across multiple chunks.
	 * 
	 * @param {Object} chat - The chat input object to send to the Mistral API.
	 * @param {string} [model] - Optional. The model identifier to use for generating responses. If not
	 * provided, a default model specified in the extension's configuration is used.
	 * @throws {Error} Throws an error if the model is not specified and no default model is configured.
	 * @private
	 */
	private async _getStreamedAnswerFromMistralAPI(chat: Object, model?: string) {
		const webview = this._view?.webview;
		const modelToUse = model || this._config.preferredModel;
		const apiKey = this._config.apiKey;

		if (!modelToUse) {
			throw new Error("Model not specified. Please provide a model or set a default value in the extension settings.");
		}

		try {
			const response = await axios.post(
				MISTRAL_CHAT_COMPLETION_URL,
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
			let buffer = '';
	
			stream.on('data', (chunk: any) => {
				buffer += chunk.toString();
	
				const items = buffer.split('data: ');
	
				items.forEach((item: string, index: number) => {
					try {
						if (item.trim() === '[DONE]') {
							webview?.postMessage({ command: 'endSession' });
							buffer = '';
							return;
						}
						if (item.trim()) {
							try {
								const jsonData = JSON.parse(item.trim());
	
								if (jsonData && jsonData.object && jsonData.object === 'chat.completion.chunk') {
									if (jsonData.choices) {
										webview?.postMessage({ command: 'newChunk', text: jsonData.choices[0].delta.content });
									}
								}
	
								if (index === items.length - 1) {
									buffer = '';
								}
							} catch (e) {
								if (index === items.length - 1) {
									// wait for more data
								} else {
									buffer = '';
								}
							}
						}
					} catch (error) {
						console.error("Error parsing item: ", error);
					}
				});
			});
		} catch (error: unknown) {
			if (axios.isAxiosError(error)) {
				if (error.response) {
					// request was made and the server answered with a status code outside of 2xx
					vscode.window.showErrorMessage("Mistral API answered with HTTP code " + error.response.status);
					console.log(error.response);
				} else if (error.request) {
					// request was made but no response received
					vscode.window.showErrorMessage("No response received from server.");
					console.log(error.request);
				} else {
					// request couldn't even be built & sent
					console.log(error.message);
				}
				console.log(error.toJSON());
			}
		}
	}

	/**
	 * Constructs the HTML content for a Visual Studio Code webview. This method
	 * prepares and includes necessary resources such as CSS for styling, JavaScript for functionality,
	 * and an SVG for a loading indicator. It ensures that resources are correctly loaded within
	 * the webview context by converting local file URIs to webview-compatible URIs.
	 * 
	 * This method utilizes the Visual Studio Code API to generate URIs for local files in the
	 * extension's media directory, making them accessible within the webview. It also employs a nonce
	 * for Content Security Policy (CSP) purposes, enhancing the security of the webview content.
	 * 
	 * The HTML structure includes links to the main stylesheet, the Highlight.js stylesheet for code
	 * syntax highlighting, and scripts for additional functionality. The method dynamically generates
	 * these links using the `webview.asWebviewUri` method to ensure they are accessible within the webview.
	 * 
	 * @param {vscode.Webview} webview - The webview instance for which to generate the HTML content.
	 * @return {string} - A string containing the full HTML document to be loaded into the webview. This
	 * includes DOCTYPE declaration, html tag with language attribute, head section with meta tags for
	 * responsive design and character set, links to CSS files, and script tags for JavaScript resources.
	 * The body of the HTML is represented as `[...]` to indicate the actual content has been omitted for brevity.
	 */
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
						<span id="startNewChat">Start new chat</span>
						<hr/>
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

/**
 * Generates a random nonce string of 32 characters. The nonce consists of 
 * alphanumeric characters, including both uppercase and lowercase letters 
 * as well as digits.
 * 
 * The function works by iterating 32 times to construct a string. In each 
 * iteration, it randomly selects a character from a predefined set of possible 
 * characters ('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789') 
 * and appends it to the result string.
 * 
 * This method is commonly used to generate a unique identifier or token for 
 * security purposes, ensuring that each output is highly unlikely to be 
 * replicated through subsequent calls.
 * 
 * @return {string} - A random 32-character alphanumeric string (nonce).
 */
function getNonce() {
	let text = '';
	const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}

/**
 * Transforms a string into a valid filename by removing or replacing characters 
 * that are not allowed in file names across various operating systems.
 * 
 * The function performs the following operations:
 * - Replaces slashes (/) with dashes (-) to avoid directory separator conflicts.
 * - Removes characters that are generally not allowed in filenames such as 
 *   <, >, :, ", \, |, ?, *, and ,.
 * - Removes trailing periods (.) as they can cause issues on Windows.
 * - Replaces all other periods (.) with dashes (-) to avoid confusion with file extensions.
 * 
 * @param {string} str - The input string to be sanitized for use as a filename.
 * @return {string} - The sanitized string, safe to use as a filename across different operating systems.
 */
function stringToValidFilename(str: string) {
	return str
		.replace(/\//g, '-')
		.replace(/</g, '')
		.replace(/>/g, '')
		.replace(/:/g, '')
		.replace(/"/g, '')
		.replace(/\\/g, '')
		.replace(/\|/g, '')
		.replace(/\?/, '')
		.replace(/\*/g, '')
		.replace(/,/g, '')
		.replace(/\.$/, '')
		.replace(/\./g, '-');	
}
