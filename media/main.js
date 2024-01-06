document.addEventListener('DOMContentLoaded', (e) => {
    const vscode = acquireVsCodeApi();

    let sessionOpen = false;

    const messageInput = document.getElementById('messageInput');
    const sendButton = document.getElementById('sendButton');

    sendButton.addEventListener('click', () => {
        sessionOpen = true;
        sendMessage();
    });

    messageInput.addEventListener('keypress', function(event) {
        if (event.key === 'Enter') {
            event.preventDefault();
            sendMessage();
        }
    });

    // Initialize a new USER/AI message exchange
    function startNewExchange() {
        const chat = document.getElementById('chat');
        const exchangeId = `exchange-${Date.now()}`;
        chat.innerHTML += `<div id="${exchangeId}" class="message ai-message"><div class="message-label">[MISTRAL]</div></div>`;
        return exchangeId;
    }

    // Append streamed chunks from Mistral API to the DOM
    function addChunkToExchange(exchangeId, content) {
        const exchangeDiv = document.getElementById(exchangeId);
        if (exchangeDiv) {
            const formattedContent = formatAIResponse(content);
            exchangeDiv.innerHTML += formattedContent;
            hljs.highlightAll();
            scrollToBottom();
        }
    }

    // Send the user input to the backend
    function sendMessage() {
        const message = messageInput.value.trim();
        if (message) {
            // TODO: disable sending other messages while the session is open
            const chat = document.getElementById('chat');
            chat.innerHTML += `<div class="message user-message"><div class="message-label">[YOU]</div>${message}</div>`;
            vscode.postMessage({
                command: 'sendMessage',
                text: message
            });
            messageInput.value = ''; // clear the input after sending
            scrollToBottom();
        }
    }

    function formatAIResponse(response) {
        const segments = response.split(/(```\w*\n[\s\S]*?```)/);

        for (let i = 0; i < segments.length; i++) {
            if (segments[i].startsWith('```')) {
                // code block: set language & escape HTML
                segments[i] = segments[i].replace(/```(\w*)\n([\s\S]*?)```/, (match, lang, code) => {
                    lang = lang || 'plaintext';
                    code = escapeHTML(code);
                    return `<pre><code class="language-${lang}">${code}</code></pre>`;
                });
            } else {
                // non-code blocks: replace newlines with <br>
                segments[i] = segments[i].replace(/\n/g, '<br>');
            }
        }

        return segments.join(''); // reassemble
    }

    // Escape HTML characters to prevent XSS attacks
    function escapeHTML(code) {
        return code
            .replace(/&/g, '&amp')
            .replace(/</g, '&lt')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
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
                const currentExchangeId = vscode.getState().currentExchangeId;
                addChunkToExchange(currentExchangeId, message.text);
                break;
            case 'endSession':
                vscode.setState({ currentExchangeId: null });
                // TODO: reenable sending other messages to the AI
                break;
        }
    });

    // Autoscroll the chat div
    function scrollToBottom() {
        const chat = document.getElementById('chat');
        chat.scrollTop = chat.scrollHeight;
    }
});
