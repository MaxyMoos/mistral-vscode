import * as vscode from 'vscode';
import axios from 'axios';


export function activate(context: vscode.ExtensionContext) {
	let disposable = vscode.commands.registerCommand('mistral-vscode.askmistral', async () => {
		const prompt = await vscode.window.showInputBox( {
			placeHolder: "Ask Mistral AI..."
		} );

		if (prompt) {
			try {
				let doc = await vscode.workspace.openTextDocument({
					language: 'plaintext',
					content: `[QUESTION]\n${prompt}\n\n[MISTRAL]\n`
				});
				let editor = await vscode.window.showTextDocument(doc, { preview: false });

				getAnswerFromMistralAPI(prompt, (content) => {
					editor.edit((editBuilder) => {
						const lastLine = editor.document.lineAt(editor.document.lineCount - 1);
						const lastLineEnd = lastLine.range.end;
						editBuilder.insert(lastLineEnd, content);
					});
				});
				
			} catch (error) {
				vscode.window.showErrorMessage("Error fetching answer from Mistral API: " + String(error));
			}
		}
	});

	context.subscriptions.push(disposable);
}

async function getAnswerFromMistralAPI(question: string, updateContent: (content: string) => void) {
	const apiUrl = 'https://api.mistral.ai/v1/chat/completions';
	const model = vscode.workspace.getConfiguration('mistral-vscode').preferredModel;
	const apiKey = vscode.workspace.getConfiguration('mistral-vscode').apiKey;

	const response = await axios.post(
		apiUrl,
		{
			model: model,
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

export function deactivate() {}
