/**
 * Safely navigates and extracts nested properties using dot-notation.
 */
function getNestedValue(obj: any, path: string): any {
  if (obj === null || obj === undefined) return undefined;
  const parts = path.split('.');
  let current = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    current = current[part];
  }
  return current;
}

/**
 * Sets a nested property on a target object, creating parent objects as needed.
 */
function setNestedValue(target: any, path: string, value: any): void {
  const parts = path.split('.');
  let current = target;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!(part in current) || typeof current[part] !== 'object' || current[part] === null) {
      current[part] = {};
    }
    current = current[part];
  }
  current[parts[parts.length - 1]] = value;
}

/**
 * Filters a single object to only include fields specified in `paths`.
 */
export function projectObject(obj: Record<string, any>, paths: string[]): Record<string, any> {
  const result: Record<string, any> = {};
  for (const path of paths) {
    const value = getNestedValue(obj, path);
    if (value !== undefined) {
      setNestedValue(result, path, value);
    }
  }
  return result;
}

/**
 * Applies projection paths to either a single object or an array of objects.
 * If data is primitive or paths is empty/undefined, returns data unmodified.
 */
export function applyProjection<T>(data: T, paths?: string[]): T | Record<string, any> | Record<string, any>[] {
  if (!paths || paths.length === 0 || data === null || typeof data !== 'object') {
    return data;
  }

  if (Array.isArray(data)) {
    return data.map((item) => (item !== null && typeof item === 'object' ? projectObject(item, paths) : item));
  }

  return projectObject(data as Record<string, any>, paths);
}
