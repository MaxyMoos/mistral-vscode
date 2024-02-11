class ChatMessage {
    constructor(role, content) {
        this.role = role,
        this.content = content;
    }
}

document.addEventListener('DOMContentLoaded', (e) => {
    const vscode = acquireVsCodeApi();

    // session variables
    const defaultModel = window.defaultModel;
    const loadingSvgUri = window.loadingSvgUri;
    
    let currentChat = [];
    let currentChatTitle = '';
    let currentChatID = `chat-${Date.now()}`;
    let currentAIResponse = '';
    let currentModel = defaultModel;

    let isInsideCodeBlock = false;
    let codeBlockCounter = 1;
    let delimiterBuffer = '';

    const chat = document.getElementById('chat');
    const messageInput = document.getElementById('messageInput');
    const sendButton = document.getElementById('sendButton');
    const startNewChatButton = document.getElementById('startNewChat');

    const originalInputHeight = messageInput.style.height;

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
    startNewChatButton.addEventListener('click', startNewChat);
    sendButton.addEventListener('click', sendUserMessage);
    messageInput.addEventListener('keypress', function(event) {
        if (event.key === 'Enter' && !event.shiftKey && !sendButton.disabled) {
            event.preventDefault();
            sendUserMessage();
        }
    });
    messageInput.addEventListener('input', () => {
        messageInput.style.height = 'auto'; // Reset the height
        messageInput.style.height = messageInput.scrollHeight + 'px'; // Set height based on content
    });

    // If there's a previous state, the webview was hidden then shown back again, so restore latest chat
    let previousState = vscode.getState();
    if (previousState && previousState.lastChat) {
        openChat({
            chatID: previousState.lastChatID,
            model: previousState.model || defaultModel,
            messages: previousState.lastChat,
            currentChatTitle: previousState.lastChatTitle
        });
    }

    /*** ======================= ***/
    /*** CHAT HANDLING FUNCTIONS ***/
    /*** ======================= ***/

    // Clean up everything
    function startNewChat() {
        currentChat = [];
        currentChatTitle = '';
        currentAIResponse = '';
        currentChatID = `chat-${Date.now()}`;
        chat.innerHTML = '';
        vscode.setState({ currentExchangeId: null, lastChat: currentChat, lastChatID: currentChatID, lastChatTitle: currentChatTitle });
    }

    /* Open a chat from history */
    function openChat(chatData) {
        startNewChat();
        currentModel = chatData.model;
        // TODO - update tooltip to reflect active model
        currentChatID = chatData.chatID;
        currentChat = chatData.messages;
        for (var i = 0; i < currentChat.length; i++) {
            chat.innerHTML += formatMessage(currentChat[i]);
        }
        hljs.highlightAll();
        scrollToBottom();
    }

    /* Formats a chat message from a previous chat session */
    function formatMessage(chatMessage) {
        let escapedContent = escapeHTML(chatMessage.content);

        // Regex to detect code blocks in Markdown triple-quotes
        var codeBlockRegex = /```(\w+)?\s([^`]+)```/g;
        escapedContent = escapedContent.replace(codeBlockRegex, function(match, language, code) {
            var languageClass = language ? `language-${language}` : 'language-plaintext';
            return `<pre><code class="${languageClass}">${code}</code></pre>`;
        });

        escapedContent = formatTextOutsideCodeBlocks(escapedContent);

        // Regular expression to match '\n' outside of '<pre>' and '</pre>'
        var regex = /(<pre>.*?<\/pre>)|(\n)/gs;
        escapedContent = escapedContent.replace(regex, function (match, codeBlock, newline) {
            if (codeBlock) {
                return codeBlock; // Return '<pre>' content unchanged
            } else {
                return '<br>'; // Replace '\n' with '<br>' outside of '<pre>'
            }
        });

        switch (chatMessage.role) {
            case 'assistant':
                return `<div class="message ai-message"><div class="message-label">[MISTRAL]</div>${escapedContent}</div>`;
            case 'user':
                return `<div class="message user-message"><div class="message-label">[YOU]</div>${escapedContent}</div>`;
        }
    }

    function formatTextOutsideCodeBlocks(text) {
        const regex = /<code>[\s\S]*?<\/code>|([\s\S]*?)(?=<code>|$)/g;

        return text.replace(regex, (match, nonCodePart) => {
            if (nonCodePart !== undefined) {
                var codeTermsRegex = /`([^`]+)`/g;
                var boldRegex = /\*\*([\wÀ-ÖØ-öø-ÿ\s\(\)\[\]\-\+:=]+)\*\*/g; // awful but works
                return nonCodePart
                    .replace(codeTermsRegex, function(match, codeTerm) { return `<code>${codeTerm}</code>`; })
                    .replace(boldRegex, function(match, boldTerm) { return `<b>${boldTerm}</b>`; });
            } else {
                // This is a <code> block, return it unchanged
                return match;
            }
        });
    }

    // Send the user input to the backend
    function sendUserMessage() {
        const message = messageInput.value.trim();
        if (message) {
            let currentMessage = new ChatMessage("user", message);

            // Format & append user message to chat window
            chat.innerHTML += formatMessage(currentMessage);

            // send chat (history + new message) to backend for API call
            currentChat.push(currentMessage);
            vscode.postMessage({
                command: 'sendMessage',
                chat: currentChat,
                model: currentModel,
            });

            // UI stuff
            messageInput.value = ''; // clear the input after sending
            messageInput.style.height = originalInputHeight; // reset original input height
            messageInput.disabled = true;
            sendButton.disabled = true;
            scrollToBottom();
        }
    }

    // Initialize a new USER/AI message exchange (called after the user input has been well received by the backend)
    function startNewExchange() {
        currentAIResponse = '';
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
        if (!isInsideCodeBlock && content.match(/```/) && !content.match(/```(\w+)?\n/)) {
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

        exchangeDiv.innerHTML = formatTextOutsideCodeBlocks(exchangeDiv.innerHTML);
        hljs.highlightAll();
        scrollToBottom();
    }

    // Handle communications with the 'backend'
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
                let aiChatMessage = new ChatMessage("assistant", currentAIResponse);
                currentChat.push(aiChatMessage);
                vscode.setState({
                    currentExchangeId: null,
                    model: currentModel,
                    lastChat: currentChat,
                    lastChatID: currentChatID,
                    lastChatTitle: currentChatTitle,
                });

                // if necessary, save chat to file
                vscode.postMessage({
                    command: 'saveChat',
                    chatID: currentChatID,
                    chatTitle: currentChatTitle,
                    contents: JSON.stringify({ model: currentModel, messages: currentChat }, undefined, 4)
                });

                // reenable sending other prompts to the API
                messageInput.disabled = false;
                sendButton.disabled = false;
                break;
            case 'openChat':
                openChat(message.data);
                break;
            case 'startNewChat':
                startNewChat();
                break;
            case 'setChatTitle':
                currentChatTitle = message.title;
                break;
        }
    });

    // Autoscroll the chat div
    function scrollToBottom() {
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
