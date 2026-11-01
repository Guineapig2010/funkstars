// Web Worker: runs the full analysis + chart generation off the main thread.
import { analyzeAudio } from './analyzer';
import { generateCharts, GENERATOR_VERSION } from './chartGen';
import { validateChart } from './validate';
import type { SongChartFile } from '../types';
import { DIFFICULTIES } from '../types';

export interface WorkerRequest { id: string; mono: Float32Array; sampleRate: number; bpm?: number }
export type WorkerResponse =
  | { type: 'progress'; p: number; stage: string }
  | { type: 'done'; file: SongChartFile }
  | { type: 'error'; message: string };

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const { id, mono, sampleRate, bpm } = e.data;
  const post = (m: WorkerResponse) => (self as unknown as Worker).postMessage(m);
  try {
    const res = analyzeAudio(mono, sampleRate, { bpmOverride: bpm, onProgress: (p, stage) => post({ type: 'progress', p: p * 0.8, stage }) });
    post({ type: 'progress', p: 0.85, stage: 'Generating Normal / Hard / Extreme charts' });
    const charts = generateCharts(res, id);
    post({ type: 'progress', p: 0.95, stage: 'Validating sync & playability' });
    const file: SongChartFile = { version: 1, songId: id, generator: GENERATOR_VERSION, analysis: res.analysis, charts, validation: {} };
    for (const d of DIFFICULTIES) file.validation![d] = validateChart(charts[d], res);
    post({ type: 'done', file });
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
