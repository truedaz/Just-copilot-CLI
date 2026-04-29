# Coplit CLI Web Interface

A simple web interface for Coplit CLI, inspired by the original CLI and https://github.com/truedaz/Copilot-cli. This app provides a chat UI for interacting with AI models and agents, with local chat history and a clean, modern design.

## Features
- Model selection dropdown (e.g., GPT-4, GPT-3.5, Custom)
- Mode selector: Agent / Ask / Plan
- Chat interface: send and receive messages
- Chat history: list, select, create new, stored in your browser (localStorage)
- No team/multi-user features

## Getting Started

### Prerequisites
- Node.js (v18 or newer recommended)
- npm (comes with Node.js)

### Install dependencies

```
npm install
```

### Run the app locally

You need two terminals (or run `npm start` to run both):

1. **Start the proxy server:**
   ```bash
   npm run server
   ```
   This server executes the `gh copilot` commands.

2. **Start the frontend:**
   ```bash
   npm run dev
   ```

### Prerequisites for Copilot
- [GitHub CLI](https://cli.github.com/) installed.
- [Copilot Extension](https://github.com/github/gh-copilot) installed: `gh extension install github/gh-copilot`.
- Authenticated: `gh auth login`.

## Project Structure
- `src/App.jsx`: Main UI and logic
- `src/`: All source code
- `public/`: Static assets

## Notes
- All chat data is stored locally in your browser and never sent to a server by default.
- To connect to a real backend or model API, add your integration in `App.jsx` where marked.

## Connecting to Copilot (API/Backend)

To connect this web interface to Copilot (or your own backend/agent), follow these steps:

1. **Review the reference implementation:**
   - See the original CLI repo for working API integration: https://github.com/truedaz/Copilot-cli

2. **Set up your backend/API:**
   - Ensure you have an API endpoint that accepts chat messages and returns responses (see the reference repo for example server code).
   - You may need an API key or authentication depending on your backend.

3. **Add environment variables:**
   - Create a `.env` file in the project root (this file is gitignored by default).
   - Example:
     ```env
     VITE_API_URL=https://your-copilot-backend.example.com/api
     VITE_API_KEY=your_api_key_here
     ```

4. **Update the frontend code:**
   - In `src/App.jsx`, locate the section marked `// TODO: Add agent/model response here`.
   - Replace it with a call to your backend, e.g.:
     ```js
     fetch(import.meta.env.VITE_API_URL, {
       method: 'POST',
       headers: {
         'Content-Type': 'application/json',
         'Authorization': `Bearer ${import.meta.env.VITE_API_KEY}`
       },
       body: JSON.stringify({
         model,
         mode,
         messages: updated.find(c => c.id === currentChatId).messages
       })
     })
       .then(res => res.json())
       .then(data => {
         // Add agent response to chat
       });
     ```
   - See the reference repo for more details on request/response structure.

5. **Restart the dev server** after changing environment variables.

---

For more details, see the [reference Copilot CLI repo](https://github.com/truedaz/Copilot-cli).
