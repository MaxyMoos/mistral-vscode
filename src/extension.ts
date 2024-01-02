import * as vscode from 'vscode';
const axios = require('axios').default;

export function activate(context: vscode.ExtensionContext) {
	const myScheme = 'askmistral';
	const myProvider = new (class implements vscode.TextDocumentContentProvider {
		onDidChange?: vscode.Event<vscode.Uri> | undefined;

		async provideTextDocumentContent(uri: vscode.Uri, token: vscode.CancellationToken): Promise<string | null> {
			const answer = await getAnswerFromMistralAPI(uri.path);
			const full_contents = `[QUESTION]\n${uri.path}\n\n[MISTRAL]\n${answer}`;
			return full_contents;
		}
		
	});
	vscode.workspace.registerTextDocumentContentProvider(myScheme, myProvider);

	let disposable = vscode.commands.registerCommand('mistral-vscode.askmistral', async () => {
		const prompt = await vscode.window.showInputBox( {
			placeHolder: "Ask Mistral AI..."
		} );

		if (prompt) {
			try {
				let uri = vscode.Uri.parse('askmistral:' + prompt);
				const doc = await vscode.workspace.openTextDocument(uri);
				await vscode.window.showTextDocument(doc, { preview: false });
				// const answer = await getAnswerFromMistralAPI(prompt);
				// const fullcontents = `[QUESTION]\n${prompt}\n\n[MISTRAL]\n${answer}`;
				// await vscode.window.showTextDocument(fullcontents, { preview: false });
			} catch (error) {
				vscode.window.showErrorMessage("Error fetching answer from Mistral API: " + String(error));
			}
		}
	});

	context.subscriptions.push(disposable);
}

async function getAnswerFromMistralAPI(question: string) {
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
		},
		{ headers: { 'Authorization': `Bearer ${apiKey}` } }
	);

	if (response.status === 200) {
		const usage = response.data.usage;
		const answer = response.data.choices[0].message.content;
		return answer;
	} else {
		vscode.window.showErrorMessage("API returned error " + response.status);
	}
}

// This method is called when your extension is deactivated
export function deactivate() {}
