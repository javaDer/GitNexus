import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import readline from 'node:readline';

export interface AnalyzeCommandOptions {
  force?: boolean;
  embeddings?: boolean;
  dropEmbeddings?: boolean;
}

export interface AnalyzeCliProcess {
  child: ChildProcess;
  events: EventEmitter;
  completion: Promise<void>;
}

export const buildAnalyzeCommandArgs = (
  repoPath: string,
  options?: AnalyzeCommandOptions,
): string[] => {
  const args = [
    process.env.GITNEXUS_ANALYZE_CLI_PATH ?? '/app/gitnexus/dist/cli/index.js',
    'analyze',
    repoPath,
  ];
  if (options?.force) args.push('--force');
  if (options?.embeddings) args.push('--embeddings');
  if (options?.dropEmbeddings) args.push('--drop-embeddings');
  return args;
};

const trimBufferedOutput = (value: string): string => {
  if (value.length <= 4096) return value;
  return value.slice(-4096);
};

const emitProgressFromLine = (events: EventEmitter, line: string): void => {
  const cleaned = line
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\r/g, '')
    .trim();
  if (!cleaned) return;

  const percentMatch = cleaned.match(/(\d{1,3})%/);
  events.emit('progress', {
    phase: 'analyzing',
    percent: percentMatch ? Math.min(99, Number(percentMatch[1])) : -1,
    message: cleaned,
  });
};

export const runAnalyzeCli = (
  repoPath: string,
  options?: AnalyzeCommandOptions,
): AnalyzeCliProcess => {
  const events = new EventEmitter();
  const args = buildAnalyzeCommandArgs(repoPath, options);
  const child = spawn(process.execPath, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=8192' },
  });

  let stderrTail = '';
  let stdoutTail = '';

  const pipeLines = (stream: NodeJS.ReadableStream | null, collect: (line: string) => void) => {
    if (!stream) return;
    const rl = readline.createInterface({ input: stream });
    rl.on('line', collect);
    child.on('close', () => rl.close());
  };

  pipeLines(child.stdout, (line) => {
    stdoutTail = trimBufferedOutput(`${stdoutTail}${line}\n`);
    emitProgressFromLine(events, line);
  });
  pipeLines(child.stderr, (line) => {
    stderrTail = trimBufferedOutput(`${stderrTail}${line}\n`);
    emitProgressFromLine(events, line);
  });

  const completion = new Promise<void>((resolve, reject) => {
    child.once('error', (err) => {
      reject(new Error(`Analyze CLI process error: ${err.message}`));
    });
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      const tail = (stderrTail || stdoutTail).trim().split('\n').pop();
      reject(
        new Error(
          `Analyze CLI failed${signal ? ` with signal ${signal}` : ` with exit code ${code}`}${
            tail ? `: ${tail}` : ''
          }`,
        ),
      );
    });
  });

  return { child, events, completion };
};
