import express from 'express';
import cors from 'cors';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const app = express();
const port = 3001;

app.use(cors());
app.use(express.json());

// Helper to escape shell commands
const escape = (str) => str.replace(/"/g, '\\"');

app.post('/api/chat', async (req, res) => {
  const { prompt, model, mode } = req.body;
  console.log(`Received request: mode=${mode}, model=${model}, prompt="${prompt}"`);

  try {
    const modelFlag = model && model !== 'default' ? `--model ${model}` : '';
    const modeFlag = mode === 'Plan' ? '--plan' : '';
    const parts = ['gh copilot', `-p "${escape(prompt)}"`, modelFlag, modeFlag, '--no-remote', '-s'];
    const command = parts.filter(Boolean).join(' ');

    console.log(`Executing: ${command}`);

    const { stdout, stderr } = await execAsync(command);
    
    console.log('CLI Output:', stdout);
    if (stderr) console.error('CLI Stderr:', stderr);

    // If we get the deprecation notice in stdout, we should still return it so the user can see it
    // or try to find a workaround. But for now, we just pass it back.
    const cleanResponse = stdout.trim() || stderr.trim();
    res.json({ response: cleanResponse });
  } catch (error) {
    console.error('Error executing CLI:', error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(port, () => {
  console.log(`Copilot Proxy Server running at http://localhost:${port}`);
});
