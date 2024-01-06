document.addEventListener('DOMContentLoaded', (e) => {
    const vscode = acquireVsCodeApi();

    const messageInput = document.getElementById('messageInput');
    const sendButton = document.getElementById('sendButton');

    sendButton.addEventListener('click', sendMessage);
    messageInput.addEventListener('keypress', function(event) {
        if (event.key === 'Enter') {
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
        
        // Replace Markdown code blocks
        response = response.replace(/```(\w+)?\n([\s\S]*?)```/g, (match, lang, code) => {
            lang = lang || 'plaintext';
            code = escapeHTML(code);
            return `<pre><code class="language-${lang}">${code}</code></pre>`;
        });
        
        // Replace newlines with <br>
        response = response.replace(/\n/g, '<br>');

        return response;
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
                const chat = document.getElementById('chat');
                const formattedMessage = formatAIResponse(message.text);
                chat.innerHTML += `<div class="message ai-message"><div class="message-label">[MISTRAL]</div>${formattedMessage}</div>`;
                hljs.highlightAll();
                scrollToBottom();
                break;
        }
    });

    // Autoscroll the chat div
    function scrollToBottom() {
        const chat = document.getElementById('chat');
        chat.scrollTop = chat.scrollHeight;
    }
});
