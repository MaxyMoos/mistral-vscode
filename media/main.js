document.addEventListener('DOMContentLoaded', (e) => {
    const vscode = acquireVsCodeApi();

    document.getElementById('sendButton').addEventListener('click', () => {
        const msgInput = document.getElementById('messageInput');
        const message = msgInput.value;
        const chat = document.getElementById('chat');
        chat.innerHTML += `<div class="message user-message"><div class="message-label">[YOU]</div>${message}</div>`;
        vscode.postMessage({
            command: 'sendMessage',
            text: message
        });
        msgInput.value = '';  // Clear the input after sending
    });

    function formatAIResponse(response) {
        // Replace Markdown code blocks
        response = response.replace(/```(.*?)```/gs, '<pre><code>$1</code></pre>');
        
        // Replace newlines with <br>
        response = response.replace(/\n/g, '<br>');

        return response;
    }
    
    window.addEventListener('message', (event) => {
        const message = event.data;
        switch (message.command) {
            case 'newMessage':
                const chat = document.getElementById('chat');
                const formattedMessage = formatAIResponse(message.text);
                chat.innerHTML += `<div class="message ai-message"><div class="message-label">[MISTRAL]</div>${formattedMessage}</div>`;
                break;
        }
    }); 
});
