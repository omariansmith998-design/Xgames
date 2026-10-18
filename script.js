document.addEventListener("DOMContentLoaded", () => {
    const createRoomBtn = document.getElementById("create-room-btn");
    const joinRoomBtn = document.getElementById("join-room-btn");
    const roomCodeInput = document.getElementById("room-code-input");
    const roomSelection = document.getElementById("room-selection");
    const chatBox = document.getElementById("chat-box");
    const messageInput = document.getElementById("message-input");
    const sendMessageBtn = document.getElementById("send-message-btn");
    const messages = document.getElementById("messages");

    createRoomBtn.addEventListener("click", () => {
        const randomCode = Math.random().toString(36.substring(2, 8).toUpperCase());
        alert(`Room created! Code: ${randomCode}`);
        roomSelection.classList.add("hidden");
        chatBox.classList.remove("hidden");
    });

    joinRoomBtn.addEventListener("click", () => {
        const code = roomCodeInput.value.trim();
        if (code) {
            alert(`Joined room: ${code}`);
            roomSelection.classList.add("hidden");
            chatBox.classList.remove("hidden");
        } else {
            alert("Please enter a valid room code.");
        }
    });

    sendMessageBtn.addEventListener("click", () => {
        const text = messageInput.value.trim();
        if (text) {
            const msgElement = document.createElement("div");
            msgElement.textContent = text;
            messages.appendChild(msgElement);
            messageInput.value = "";
            messages.scrollTop = messages.scrollHeight;
        }
    });
});
