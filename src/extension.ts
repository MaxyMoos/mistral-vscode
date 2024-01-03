import * as vscode from 'vscode';
import axios from 'axios';


export function activate(context: vscode.ExtensionContext) {

	async function promptAndGetAnswer(model?: string) {
		const prompt = await vscode.window.showInputBox( { placeHolder: "Ask Mistral AI..." });

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
