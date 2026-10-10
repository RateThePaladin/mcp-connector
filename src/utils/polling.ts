import { executeProxyRequest } from '../proxy';
import { applyProjection } from './projection';

export interface WaitForConditionParams {
  application: string;
  host?: string;
  endpoint: string;
  targetField: string;
  expectedValue?: any;
  timeoutSeconds?: number;
  intervalMs?: number;
  select?: string[];
}

export interface PollingResult {
  conditionMet: boolean;
  elapsedMs: number;
  attempts: number;
  targetField: string;
  currentValue?: any;
  data: any;
}

export async function waitForCondition(params: WaitForConditionParams): Promise<PollingResult> {
  const {
    application,
    host = 'node',
    endpoint,
    targetField,
    expectedValue,
    timeoutSeconds = 30,
    intervalMs = 1000,
    select
  } = params;

  // Enforce a hard maximum of 60 seconds to prevent client SSE timeouts
  const maxTimeoutMs = Math.min(Math.max(timeoutSeconds, 1), 60) * 1000;
  const pollIntervalMs = Math.max(intervalMs, 250);
  const startTime = Date.now();
  let attempts = 0;
  let lastData: any = null;
  let lastValue: any = undefined;

  while (Date.now() - startTime < maxTimeoutMs) {
    attempts++;
    try {
      const response = await executeProxyRequest({
        application,
        host,
        method: 'GET',
        endpoint
      });

      lastData = response;

      const parts = targetField.split('.');
      let val = response;
      for (const p of parts) {
        if (val === null || val === undefined) {
          val = undefined;
          break;
        }
        val = val[p];
      }
      lastValue = val;

      const isMatch = expectedValue !== undefined ? val === expectedValue : Boolean(val);

      if (isMatch) {
        return {
          conditionMet: true,
          elapsedMs: Date.now() - startTime,
          attempts,
          targetField,
          currentValue: val,
          data: applyProjection(response, select)
        };
      }
    } catch {
      // Continue polling through transient network glitches until timeout
    }

    const remainingMs = maxTimeoutMs - (Date.now() - startTime);
    if (remainingMs <= 0) break;
    await new Promise((resolve) => setTimeout(resolve, Math.min(pollIntervalMs, remainingMs)));
  }

  return {
    conditionMet: false,
    elapsedMs: Date.now() - startTime,
    attempts,
    targetField,
    currentValue: lastValue,
    data: applyProjection(lastData, select)
  };
}
