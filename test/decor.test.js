import {
  applyDecorChange,
  decorView,
  normalizeDecor,
} from '../extension/src/lib/decor.js';

const image = { url: 'data:image/webp;base64,aGk=', width: 600, height: 300 };

describe('decor', () => {
  test('normalizeDecor keeps valid values and drops the rest', () => {
    expect(normalizeDecor(undefined)).toEqual({ mode: 'default', image: null });
    expect(normalizeDecor({ mode: 'none' })).toEqual({
      mode: 'none',
      image: null,
    });
    expect(normalizeDecor({ mode: 'custom', image })).toEqual({
      mode: 'custom',
      image,
    });
    for (const bad of [
      { ...image, url: 'https://example.com/a.png' },
      { ...image, url: 'data:text/html;base64,aGk=' },
      { ...image, url: 'data:image/webp;base64,a")b' },
      { ...image, width: 0 },
      { ...image, height: '300' },
      { ...image, url: `data:image/webp;base64,${'A'.repeat(3_000_000)}` },
    ])
      expect(normalizeDecor({ mode: 'custom', image: bad }).image).toBeNull();
    expect(normalizeDecor({ mode: 'huge' }).mode).toBe('default');
  });

  test('applyDecorChange keeps the image when the mode changes', () => {
    const custom = applyDecorChange(normalizeDecor(undefined), {
      mode: 'custom',
      image,
    });
    expect(custom).toEqual({ mode: 'custom', image });
    expect(applyDecorChange(custom, { mode: 'none' })).toEqual({
      mode: 'none',
      image,
    });
    expect(applyDecorChange(custom, { image: null })).toEqual({
      mode: 'custom',
      image: null,
    });
  });

  test('decorView fits a custom image in the page box; no image shows the default', () => {
    expect(decorView({ mode: 'default', image }, [200, 230])).toEqual({
      mode: 'default',
      vars: {},
    });
    expect(decorView({ mode: 'none', image }, [200, 230])).toEqual({
      mode: 'none',
      vars: { '--deco-image': 'none' },
    });
    expect(decorView({ mode: 'custom', image }, [200, 230])).toEqual({
      mode: 'custom',
      vars: {
        '--deco-image': `url("${image.url}")`,
        '--deco-fit': '200px 100px',
        '--deco-ratio': '600 / 300',
      },
    });
    expect(decorView({ mode: 'custom', image: null }, [200, 230]).mode).toBe(
      'default'
    );
  });
});
