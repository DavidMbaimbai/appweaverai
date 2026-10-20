import { describe, expect, it } from 'vitest';
import { buildFigmaSpec, parseFigmaUrl, type FigmaFileResponse } from './figma';
import { extractDesignFromHtml, isPrivateIp, normalizeWebsiteUrl } from './url';
import { designSpecToPrompt } from './to-prompt';

const file: FigmaFileResponse = {
  name: 'Shop',
  document: {
    id: '0:0',
    type: 'DOCUMENT',
    children: [
      {
        id: '0:1',
        type: 'CANVAS',
        children: [
          {
            id: '1:1',
            name: 'Home',
            type: 'FRAME',
            layoutMode: 'VERTICAL',
            itemSpacing: 16,
            absoluteBoundingBox: { width: 1440, height: 900 },
            fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }],
            children: [
              {
                id: '1:2',
                name: 'Title',
                type: 'TEXT',
                characters: 'Welcome',
                style: { fontFamily: 'Inter', fontSize: 48, fontWeight: 700 },
                fills: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }],
              },
              { id: '1:3', name: 'Button', type: 'COMPONENT', children: [] },
            ],
          },
        ],
      },
    ],
  },
};

describe('figma', () => {
  it('parses file keys and node ids', () => {
    expect(parseFigmaUrl('https://www.figma.com/design/AbC123/Name?node-id=12-34')).toEqual({
      fileKey: 'AbC123',
      nodeId: '12:34',
    });
    expect(parseFigmaUrl('https://evil.com/design/AbC123')).toBeNull();
    expect(parseFigmaUrl('http://figma.com/file/AbC123')).toBeNull();
  });

  it('builds a compact spec', () => {
    const spec = buildFigmaSpec(file);
    expect(spec.frames).toHaveLength(1);
    expect(spec.frames[0].outline.layout).toBe('column gap 16');
    expect(spec.colors.map((c) => c.hex)).toEqual(expect.arrayContaining(['#FFFFFF', '#000000']));
    expect(spec.textStyles[0]).toMatchObject({ fontFamily: 'Inter', fontSize: 48 });
    expect(spec.components).toEqual(['Button']);
    expect(designSpecToPrompt(spec)).toContain('editable');
  });
});

describe('url import', () => {
  it('blocks private addresses', () => {
    for (const ip of ['127.0.0.1', '10.0.0.5', '192.168.1.1', '169.254.169.254', '::1', '::ffff:10.0.0.1', 'fd00::1']) {
      expect(isPrivateIp(ip)).toBe(true);
    }
    expect(isPrivateIp('8.8.8.8')).toBe(false);
    expect(normalizeWebsiteUrl('http://localhost')).toBeNull();
    expect(normalizeWebsiteUrl('example.com')).toBe('https://example.com');
  });

  it('extracts design data from HTML', () => {
    const spec = extractDesignFromHtml(
      '<title>Acme</title><style>body{font-family:"Poppins",sans-serif;color:#ff6600}h1{color:#f60}</style><nav><a>Home</a></nav><h1>Hi &amp; welcome</h1><button>Go</button>',
      'https://acme.com',
    );
    expect(spec.name).toBe('Acme');
    expect(spec.headings).toEqual(['h1: Hi & welcome']);
    expect(spec.colors[0]).toEqual({ hex: '#FF6600', count: 2 });
    expect(spec.fonts).toContain('Poppins');
    expect(spec.notes.join()).toContain('1 buttons');
  });
});
