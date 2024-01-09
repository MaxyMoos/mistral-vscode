document.addEventListener('DOMContentLoaded', (e) => {
    const vscode = acquireVsCodeApi();

    // session variables
    let isInsideCodeBlock = false;
    let codeBlockCounter = 1;
    let delimiterBuffer = '';

    // let allChunks = [" a size"," of"," `RING","_BUFFER_","SIZE` elements",".\n\n","```c","\n#include"," <stddef",".h>","\n#include"," <","stdint",".h>","\n\n#","define RING","_BUFFER_","SIZE 1","6\n\n","typedef"," struct {\n","    uint8","_","t buffer","[R","ING","_BUFFER","_SIZE];","\n    size","_t head",";\n   "," size_t"," tail;\n","    size_","t"," count;","\n} ring","_buffer_","t;\n","\nvoid ring","_buffer_","init(ring","_buffer_","t *rb",") {\n","   "," rb->","head = ","0;\n","    rb->","tail = ","0;\n","    rb","->count ="," 0;","\n}\n","\n","int ring","_buffer_","full(ring","_buffer_","t *rb",") {\n","    return (","rb->count"," + 1",") % R","ING","_BUFFER","_SIZE =="," rb->head",";\n}","\n\nint"," ring_buffer","_empty(","ring_","buffer","_t"," *rb)"," {\n   "," return rb->","count == ","0;\n","}\n\n","int ring_","buffer_push","(ring_","buffer_t"," *rb,"," uint8_","t data)"," {\n   "," if (ring","_buffer","_","full(","rb)) {","\n        return"," -1;"," // Buffer is"," full\n   "," }\n\n","    rb->","buffer[rb","->head]"," = data;","\n    rb","->head ="," (rb->","head +"," 1)"," % RING","_BUFFER_","SIZE;\n","    rb->","count++;\n","\n    return"," 0;","\n}\n","\nint ring","_buffer_","pop","(","ring","_buffer","_t *","rb, uint","8_t"," *data)"," {\n   "," if (ring","_buffer","_","empty(","rb",")) {","\n        return"," -1;"," // Buffer is"," empty\n   "," }\n\n","    *data"," = rb->","buffer[","rb","->tail];","\n    rb","->tail"," = (rb","->","tail +"," ","1)"," % RING","_","BUFFER_","SIZE;","\n","    rb->","count--;","\n\n   "," return 0",";\n}","\n\n","int ring_","buffer_pe","ek(ring","_","buffer","_t *","rb, uint","8_t"," *data)"," {\n   "," if (ring","_buffer_","empty(","rb))"," {","\n       "," return -1","; // Buffer"," is empty","\n    }","\n\n   "," *data"," = rb->","buffer[rb","->tail];","\n\n","    return ","0;\n","}\n","```\n","\nThe `","ring_buffer","_t","` structure stores"," the buffer,"," head"," and"," tail indices,"," and the current"," count of elements"," in the"," buffer.\n","\nThe `","ring_buffer","_init`"," function initial","izes the buffer"," to the empty"," state.\n","\nThe `","ring_buffer","_full`"," and `ring","_buffer_","empty`"," functions check if"," the"," buffer is"," full or empty",", respectively.","\n\nThe"," `ring_","buffer_push","` function"," adds a new"," element to the"," buffer. It"," checks"," if the"," buffer is full"," before pushing and"," updates the head"," index accordingly",".\n\n","The `ring","_buffer_","pop` function"," removes an"," element from the"," buffer and updates"," the tail"," index. It"," checks if the"," buffer is empty"," before popping",".\n\n","The `ring","_buffer_","peek","` function returns"," the element at"," the tail index"," without removing it",", so it"," can be used"," to inspect"," the most recent"," element in the"," buffer without consum","ing it.","",""];

    const messageInput = document.getElementById('messageInput');
    const sendButton = document.getElementById('sendButton');

    sendButton.addEventListener('click', sendMessage);
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
        return escapeHTML(content).replace(/\n/g, '<br>');
    }

    function formatCodeBlock(codeContent) {
        return `<pre><code>${codeContent}</code></pre>`;
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

    function test() {
        const exchangeId = startNewExchange();
        for (let i = 0; i < allChunks.length; i++) {
            addChunkToExchange(exchangeId, allChunks[i]);
        }
        if (delimiterBuffer.length) {
            addChunkToExchange(exchangeId, "");
        }
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
