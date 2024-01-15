document.addEventListener('DOMContentLoaded', (e) => {
    const vscode = acquireVsCodeApi();

    // session variables
    let currentChat = [];
    let currentAIResponse = '';

    let isInsideCodeBlock = false;
    let codeBlockCounter = 1;
    let delimiterBuffer = '';

    const messageInput = document.getElementById('messageInput');
    const sendButton = document.getElementById('sendButton');

    const loadingSvgUri = window.loadingSvgUri;

    sendButton.addEventListener('click', sendMessage);
    messageInput.addEventListener('keypress', function(event) {
        if (event.key === 'Enter' && !sendButton.disabled) {
            event.preventDefault();
            sendMessage();
        }
    });

    // Send the user input to the backend
    function sendMessage() {
        const message = messageInput.value.trim();
        if (message) {
            const chat = document.getElementById('chat');
            chat.innerHTML += `<div class="message user-message"><div class="message-label">[YOU]</div>${message}</div>`;

            // send chat to backend
            currentChat.push({role: "user", content: message});
            vscode.postMessage({
                command: 'sendMessage',
                chat: currentChat,
            });

            // UI stuff
            messageInput.value = ''; // clear the input after sending
            messageInput.disabled = true;
            sendButton.disabled = true;
            scrollToBottom();
        }
    }

    // Initialize a new USER/AI message exchange (called after the user input has been well received by the backend)
    function startNewExchange() {
        currentAIResponse = '';
        const chat = document.getElementById('chat');
        const exchangeId = `exchange-${Date.now()}`;
        chat.innerHTML += `<div id="${exchangeId}" class="message ai-message"><div class="message-label">[MISTRAL]</div><div id="response-loading"><img src="${loadingSvgUri}"></div></div>`;
        return exchangeId;
    }

    // Append streamed chunks from Mistral API to the DOM
    function addChunkToExchange(exchangeId, content) {
        const exchangeDiv = document.getElementById(exchangeId);
        if (!exchangeDiv) { return; }

        content = delimiterBuffer + content;
        delimiterBuffer = '';

        // Handle code block delimiters on the edge of chunks
        if (content.endsWith('```')) {
        } else if (content.endsWith('``')) {
            delimiterBuffer = '``';
            content = content.slice(0, -2);
        } else if (content.endsWith('`')) {
            delimiterBuffer = '`';
            content = content.slice(0, -1);
        }

        // Handle code block language being split across chunks
        if (!isInsideCodeBlock && content.match(/```/) && !content.match(/```\w+\n/)) {
            // we're missing the language, bufferize the partial match
            delimiterBuffer = '```' + content.split('```')[1];
            content = content.slice(0, content.indexOf('```'));
        }
            
        // splitting in order to be able to stream code blocks with syntax highlighting
        const parts = content.split('```');
        for (let i = 0; i < parts.length; i++) {
            if (i % 2 === 0) {
                if (isInsideCodeBlock) { // append content to the current code block
                    const currentCodeBlock = document.getElementById(`code-${codeBlockCounter}`);
                    if (currentCodeBlock) {
                        currentCodeBlock.innerHTML = escapeHTML(currentCodeBlock.innerText + parts[i]);
                        delete currentCodeBlock.dataset.highlighted;
                    }
                } else {
                    exchangeDiv.innerHTML += escapeHTML(parts[i]).replace(/\n/g, '<br>');
                }
            } else {
                if (!isInsideCodeBlock) {
                    const languageMatch = parts[i].match(/^(\w+)/);
                    let currentCodeLanguage = languageMatch ? languageMatch[1] : 'plaintext';
                    exchangeDiv.innerHTML += `<pre id="current-code-block"><code id="code-${codeBlockCounter}" class="language-${currentCodeLanguage}">`;
                    isInsideCodeBlock = true;

                    // add the remaining part of the chunk after the language identifier
                    const codeContent = parts[i].substr(parts[i].indexOf('\n') + 1);
                    const currentCodeBlock = document.getElementById(`code-${codeBlockCounter}`);
                    if (currentCodeBlock) {
                        currentCodeBlock.innerHTML += escapeHTML(codeContent);
                    }
                } else {
                    // code block is ending
                    const currentCodeBlock = document.getElementById(`code-${codeBlockCounter}`);
                    document.getElementById('current-code-block').id = `pre-${codeBlockCounter}`;
                    codeBlockCounter += 1;
                    exchangeDiv.innerHTML += `</code></pre>` + escapeHTML(parts[i]).replace(/\n/g, '<br>');
                    isInsideCodeBlock = false;
                }
            }
        }

        hljs.highlightAll();
        scrollToBottom();
    }

    // Handle AI responses transmitted by the 'backend'
    window.addEventListener('message', (event) => {
        const message = event.data;
        switch (message.command) {
            case 'newMessage':
                const exchangeId = startNewExchange();
                vscode.setState({ currentExchangeId: exchangeId });
                scrollToBottom();
                break;
            case 'newChunk':
                if (currentAIResponse.length === 0) {
                    let anim = document.getElementById('response-loading');
                    if (anim) {
                        anim.remove();
                    }
                }
                currentAIResponse += message.text;

                // format & display chunk into webview
                const currentExchangeId = vscode.getState().currentExchangeId;
                addChunkToExchange(currentExchangeId, message.text);
                break;
            case 'endSession':
                currentChat.push({role: "assistant", content: currentAIResponse});
                vscode.setState({ currentExchangeId: null });

                // reenable sending other prompts to the API
                messageInput.disabled = false;
                sendButton.disabled = false;
                break;
        }
    });

    // Autoscroll the chat div
    function scrollToBottom() {
        const chat = document.getElementById('chat');
        chat.scrollTop = chat.scrollHeight;
    }

    // Escape HTML characters to prevent XSS attacks
    function escapeHTML(code) {
        return code
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }
    
});
