document.addEventListener('DOMContentLoaded', (e) => {
    const vscode = acquireVsCodeApi();

    // session variables
    const defaultModel = window.defaultModel;
    const mustSaveChats = window.mustSaveChats;
    const saveChatsLocation = window.saveChatsLocation;
    const loadingSvgUri = window.loadingSvgUri;
    
    let currentChat = [];
    let currentChatID = `chat-${Date.now()}`;
    let currentAIResponse = '';
    let currentModel = defaultModel;

    let isInsideCodeBlock = false;
    let codeBlockCounter = 1;
    let delimiterBuffer = '';

    const messageInput = document.getElementById('messageInput');
    const sendButton = document.getElementById('sendButton');

    /*** Model selection ***/
    function toggleTooltip() {
        const tooltip = document.getElementById('modelTooltip');
        tooltip.style.display = tooltip.style.display === 'block' ? 'none' : 'block';
    }
    
    // Close the tooltip when clicking outside
    window.onclick = function(event) {
        if (!event.target.matches('.cog-icon') && !event.target.matches('.tooltip ul li')) {
            const tooltips = document.getElementsByClassName('tooltip');
            for (let i = 0; i < tooltips.length; i++) {
                tooltips[i].style.display = 'none';
            }
        }
    };

    const cog = document.getElementById('modelCog');
    cog.addEventListener('click', toggleTooltip);

    const modelSelectors = document.querySelectorAll('.modelSelector');
    modelSelectors.forEach(function(modelSelector) {
        if (modelSelector.dataset.model === defaultModel) {
            modelSelector.classList.add('selected');
        }

        modelSelector.addEventListener('click', function(event) {
            currentModel = this.dataset.model; // switch the active model
            document.querySelectorAll('#modelTooltip ul li').forEach(li => {
                li.classList.remove('selected');
            });
            this.classList.add('selected');
        });
    });

    /*** Event Listeners ***/
    sendButton.addEventListener('click', sendMessage);
    messageInput.addEventListener('keypress', function(event) {
        if (event.key === 'Enter' && !event.shiftKey && !sendButton.disabled) {
            event.preventDefault();
            sendMessage();
        }
    });
    messageInput.addEventListener('input', () => {
        messageInput.style.height = 'auto'; // Reset the height
        messageInput.style.height = messageInput.scrollHeight + 'px'; // Set height based on content
    });

    // Clean up everything
    function startNewChat() {
        currentChat = [];
        currentAIResponse = '';

        const chat = document.getElementById('chat');
        chat.innerHTML = '';

        currentChatID = `chat-${Date.now()}`;
    }

    // Send the user input to the backend
    function sendMessage() {
        const message = messageInput.value.trim();
        if (message) {
            const chat = document.getElementById('chat');
            chat.innerHTML += `<div class="message user-message"><div class="message-label">[YOU]</div>${escapeHTML(message)}</div>`;

            // send chat (history + new message) to backend
            currentChat.push({role: "user", content: message});
            vscode.postMessage({
                command: 'sendMessage',
                chat: currentChat,
                model: currentModel,
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
            case 'messageReceived':
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

                // if necessary, save chat to file
                vscode.postMessage({
                    command: 'saveChat',
                    chatID: currentChatID,
                    contents: JSON.stringify({ model: currentModel, messages: currentChat }, undefined, 4)
                });

                // reenable sending other prompts to the API
                messageInput.disabled = false;
                sendButton.disabled = false;
                break;
            case 'getChatAsJSON':
                vscode.postMessage({
                    command: 'didExportChatAsJSON',
                    contents: JSON.stringify({ model: currentModel, messages: currentChat }, undefined, 4)
                });
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
