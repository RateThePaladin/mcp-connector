import { projectObject, applyProjection } from '../src/utils/projection';

describe('Projection Utility', () => {
  describe('projectObject', () => {
    it('projects top-level fields', () => {
      const obj = { id: '123', name: 'Test', age: 30, internal: 'secret' };
      const projected = projectObject(obj, ['id', 'name']);
      expect(projected).toEqual({ id: '123', name: 'Test' });
    });

    it('projects nested dot-notation fields', () => {
      const obj = {
        id: '123',
        book: {
          id: 'b1',
          title: 'Project Hail Mary',
          meta: { rating: 5, pages: 400 }
        },
        status: 'IMPORTED'
      };
      const projected = projectObject(obj, ['id', 'book.id', 'book.meta.rating']);
      expect(projected).toEqual({
        id: '123',
        book: {
          id: 'b1',
          meta: { rating: 5 }
        }
      });
    });

    it('ignores paths that do not exist', () => {
      const obj = { id: '123', name: 'Test' };
      const projected = projectObject(obj, ['id', 'nonexistent', 'nested.nonexistent']);
      expect(projected).toEqual({ id: '123' });
    });
  });

  describe('applyProjection', () => {
    it('returns original input if paths is undefined or empty', () => {
      const obj = { a: 1, b: 2 };
      expect(applyProjection(obj)).toEqual(obj);
      expect(applyProjection(obj, [])).toEqual(obj);
    });

    it('returns primitive data unmodified', () => {
      expect(applyProjection('plain text', ['a'])).toEqual('plain text');
      expect(applyProjection(123, ['a'])).toEqual(123);
      expect(applyProjection(null, ['a'])).toEqual(null);
    });

    it('projects an array of objects', () => {
      const list = [
        { id: '1', name: 'Alice', secret: 'foo' },
        { id: '2', name: 'Bob', secret: 'bar' }
      ];
      const projected = applyProjection(list, ['id', 'name']);
      expect(projected).toEqual([
        { id: '1', name: 'Alice' },
        { id: '2', name: 'Bob' }
      ]);
    });
  });
});
