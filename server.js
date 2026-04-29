import express from 'express';
import cors from 'cors';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const app = express();
const port = 3001;

app.use(cors());
app.use(express.json());

// Helper to escape shell commands
const escape = (str) => str.replace(/"/g, '\\"');

app.post('/api/chat', async (req, res) => {
  const { prompt, model, mode, effort } = req.body;
  console.log(`Received request: mode=${mode}, model=${model}, effort=${effort}, prompt="${prompt}"`);

  const buildCommand = (includeEffort) => {
    const modelFlag = model && model !== 'default' ? `--model ${model}` : '';
    const modeFlag = mode === 'Plan' ? '--plan' : '';
    const effortFlag = includeEffort && effort ? `--effort ${effort}` : '';
    const parts = ['gh copilot', `-p "${escape(prompt)}"`, modelFlag, modeFlag, effortFlag, '--no-remote', '-s'];
    return parts.filter(Boolean).join(' ');
  };

  try {
    const command = buildCommand(true);
    console.log(`Executing: ${command}`);

    let stdout, stderr;
    try {
      ({ stdout, stderr } = await execAsync(command));
    } catch (firstErr) {
      // CLI exited non-zero — check if it's a reasoning effort error
      if (effort && firstErr.message?.includes('reasoning effort')) {
        console.warn('Model does not support reasoning effort (exit error) — retrying without it');
        const fallback = buildCommand(false);
        console.log(`Retrying: ${fallback}`);
        ({ stdout, stderr } = await execAsync(fallback));
      } else {
        throw firstErr;
      }
    }

    console.log('CLI Output:', stdout);
    if (stderr) console.error('CLI Stderr:', stderr);

    let cleanResponse = stdout.trim() || stderr.trim();

    // Some models return the error in stdout with exit code 0 — catch and retry
    if (effort && /does not support reasoning effort/i.test(cleanResponse)) {
      console.warn('Model does not support reasoning effort (stdout) — retrying without it');
      const fallback = buildCommand(false);
      console.log(`Retrying: ${fallback}`);
      const result = await execAsync(fallback);
      cleanResponse = result.stdout.trim() || result.stderr.trim();
    }

    res.json({ response: cleanResponse });
  } catch (error) {
    console.error('Error executing CLI:', error);
    res.status(500).json({ error: error.message });
  }
});

// Streaming endpoint — starts speaking as soon as first sentences arrive
app.post('/api/chat/stream', (req, res) => {
  const { prompt, model, mode, effort } = req.body;
  if (!prompt) { res.status(400).json({ error: 'Missing prompt' }); return; }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Accel-Buffering', 'no'); // disable nginx/proxy buffering
  res.flushHeaders();

  const args = ['copilot', '-p', prompt, '--no-remote', '-s'];
  if (model && model !== 'default') args.push('--model', model);
  if (mode === 'Plan') args.push('--plan');
  if (effort) args.push('--effort', effort);

  const proc = spawn('gh', args);

  proc.stdout.on('data', (chunk) => {
    res.write(`data: ${JSON.stringify({ text: chunk.toString() })}\n\n`);
  });

  proc.stderr.on('data', () => {}); // suppress CLI noise

  proc.on('close', () => {
    res.write('data: [DONE]\n\n');
    res.end();
  });

  proc.on('error', (err) => {
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  });

  // Kill the subprocess immediately if the client disconnects (user pressed X)
  req.on('close', () => proc.kill('SIGTERM'));
});

app.listen(port, () => {
  console.log(`Copilot Proxy Server running at http://localhost:${port}`);
});
