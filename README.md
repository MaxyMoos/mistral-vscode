# mistral-vscode

Allows you to chat using the Mistral AI API directly within VS Code.

## Features

- A nice-looking (debatable) chat view
- Select the Mistral model to use on-the-fly, even mid-convo
- Mistral platform responses are streamed to the chat window
- Code blocks highlighting in responses
- Chat history, with the ability to reload a previous chat and resume the conversation
- 2 adaptive color schemes (ugly light/terrible dark)

![Mistral Chat](doc/images/chatExample.gif)

## Requirements

You'll need a Mistral API key and to set it up in the extension settings.

## Extension Settings

This extension contributes the following settings:

* `mistral-vscode.apiKey`: Your Mistral API key (not synced)
* `mistral-vscode.defaultModel`: The default Mistral model to use : `mistral-tiny`, `mistral-small` or `mistral-medium` as of February 2024 (default: `mistral-tiny`)
* `mistral-vscode.mustSaveChats`: Should VSCode save chat history (default: `false`)
* `mistral-vscode.saveChatsLocation`: If chat history is enabled, the folder in which chats are saved (default: `~/.mistral-vscode/chats/`)
* `mistral-vscode.getChatsTitlesByMistral`: If chat history is enabled, should the extension ask `mistral-tiny` to name chat files with an explicit description (default: `false`). **Enabling this _will_ cause additional Mistral API requests and thus increase billing (though not by much)**


## Known Issues

Formatting single tick elements (like variable names outside of code blocks) during streaming is not yet supported.

It does work when reloading a previous chat though.

## Release Notes

### 0.0.1

Initial release
