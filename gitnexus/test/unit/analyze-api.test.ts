import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { JobManager } from '../../src/server/analyze-job.js';
import { buildAnalyzeCommandArgs, runAnalyzeCli } from '../../src/server/analyze-cli.js';

describe('analyze API logic', () => {
  let manager: JobManager;
  let oldAnalyzeCliPath: string | undefined;

  beforeEach(() => {
    manager = new JobManager();
    oldAnalyzeCliPath = process.env.GITNEXUS_ANALYZE_CLI_PATH;
    delete process.env.GITNEXUS_ANALYZE_CLI_PATH;
  });

  afterEach(() => {
    manager.dispose();
    if (oldAnalyzeCliPath === undefined) {
      delete process.env.GITNEXUS_ANALYZE_CLI_PATH;
    } else {
      process.env.GITNEXUS_ANALYZE_CLI_PATH = oldAnalyzeCliPath;
    }
    vi.restoreAllMocks();
  });

  it('creates a job and returns 202 shape', () => {
    const job = manager.createJob({ repoUrl: 'https://github.com/user/repo' });
    const response = { jobId: job.id, status: job.status };
    expect(response.jobId).toBeTruthy();
    expect(response.status).toBe('queued');
  });

  it('rejects when job already active for different repo', () => {
    const job1 = manager.createJob({
      repoUrl: 'https://github.com/user/repo1',
    });
    manager.updateJob(job1.id, { status: 'analyzing' });
    expect(() => manager.createJob({ repoUrl: 'https://github.com/user/repo2' })).toThrow(
      /already in progress/,
    );
  });

  it('returns existing job for same repo URL', () => {
    const job1 = manager.createJob({ repoUrl: 'https://github.com/user/repo' });
    manager.updateJob(job1.id, { status: 'analyzing' });
    const job2 = manager.createJob({ repoUrl: 'https://github.com/user/repo' });
    expect(job2.id).toBe(job1.id);
  });

  it('SSE progress listener receives all events including terminal', () => {
    const job = manager.createJob({
      repoUrl: 'https://github.com/user/sse-test',
    });
    const events: any[] = [];
    const unsub = manager.onProgress(job.id, (progress) => {
      events.push(progress);
    });

    manager.updateJob(job.id, {
      status: 'analyzing',
      progress: { phase: 'parsing', percent: 30, message: 'Parsing' },
    });
    manager.updateJob(job.id, {
      progress: { phase: 'calls', percent: 50, message: 'Tracing calls' },
    });
    manager.updateJob(job.id, { status: 'complete', repoName: 'sse-test' });

    unsub();

    expect(events.length).toBe(3);
    expect(events[0].phase).toBe('parsing');
    expect(events[1].phase).toBe('calls');
    expect(events[2].phase).toBe('complete');
    expect(events[2].percent).toBe(100);
  });

  it('server analyze jobs execute the built CLI against the resolved clone path', () => {
    expect(
      buildAnalyzeCommandArgs('/data/gitnexus/repos/openclaw-websocket', {
        force: true,
        embeddings: true,
        dropEmbeddings: false,
      }),
    ).toEqual([
      '/app/gitnexus/dist/cli/index.js',
      'analyze',
      '/data/gitnexus/repos/openclaw-websocket',
      '--force',
      '--embeddings',
    ]);
  });

  it('runAnalyzeCli spawns node with the configured CLI script and target path', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gitnexus-analyze-cli-'));
    const cliPath = path.join(tmpDir, 'fake-cli.mjs');
    process.env.GITNEXUS_ANALYZE_CLI_PATH = cliPath;
    await fs.writeFile(
      cliPath,
      [
        "import fs from 'node:fs';",
        'fs.writeFileSync(process.env.CAPTURE_PATH, JSON.stringify(process.argv.slice(1)));',
      ].join('\n'),
      'utf-8',
    );
    const capturePath = path.join(tmpDir, 'argv.json');
    const oldCapturePath = process.env.CAPTURE_PATH;
    process.env.CAPTURE_PATH = capturePath;

    try {
      const processHandle = runAnalyzeCli('/data/gitnexus/repos/openclaw-websocket', {
        force: true,
      });
      await processHandle.completion;

      const argv = JSON.parse(await fs.readFile(capturePath, 'utf-8'));
      expect(argv).toEqual([
        cliPath,
        'analyze',
        '/data/gitnexus/repos/openclaw-websocket',
        '--force',
      ]);
    } finally {
      if (oldCapturePath === undefined) {
        delete process.env.CAPTURE_PATH;
      } else {
        process.env.CAPTURE_PATH = oldCapturePath;
      }
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
