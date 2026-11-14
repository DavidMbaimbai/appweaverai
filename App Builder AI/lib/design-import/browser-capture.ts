import puppeteer from 'puppeteer';
import { isSafePublicUrl } from '@/lib/outreach/compliance';
import { isPrivateIp, normalizeWebsiteUrl } from './url';
import { lookup } from 'node:dns/promises';
import { type DesignSpec, emptySpec, type ReferenceContext } from './types';

async function assertPublicHost(url: URL) {
  const addresses = await lookup(url.hostname, { all: true });
  if (addresses.length === 0 || addresses.some((a) => isPrivateIp(a.address))) {
    throw new Error('That address is not a public website.');
  }
}

export async function captureWebsiteReference(urlStr: string): Promise<DesignSpec> {
  const initial = normalizeWebsiteUrl(urlStr);
  if (!initial) throw new Error('Enter a public https:// website URL.');
  const url = new URL(initial);
  await assertPublicHost(url);

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    
    // Set a common user agent to avoid being blocked
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    await page.goto(initial, { waitUntil: 'networkidle2', timeout: 30000 });

    const title = await page.title();
    const spec = emptySpec('url', title || initial);
    spec.sourceUrl = initial;

    // Extract design tokens and sections
    const context: ReferenceContext = await page.evaluate(() => {
      const getComputedStyle = (el: Element) => window.getComputedStyle(el);
      
      const colors = new Set<string>();
      const fonts = new Set<string>();
      const spacings = new Set<string>();
      const radii = new Set<string>();

      const allElements = document.querySelectorAll('*');
      allElements.forEach(el => {
        const style = getComputedStyle(el);
        if (style.backgroundColor && style.backgroundColor !== 'rgba(0, 0, 0, 0)' && style.backgroundColor !== 'transparent') colors.add(style.backgroundColor);
        if (style.color) colors.add(style.color);
        if (style.fontFamily) fonts.add(style.fontFamily.split(',')[0].trim().replace(/['"]/g, ''));
        if (style.padding) spacings.add(style.padding);
        if (style.margin) spacings.add(style.margin);
        if (style.borderRadius && style.borderRadius !== '0px') radii.add(style.borderRadius);
      });

      // Find main sections
      const sectionElements = Array.from(document.querySelectorAll('header, nav, main, section, footer, [role="main"], .section, #section'));
      const sections = sectionElements.slice(0, 10).map((el, i) => {
        const rect = el.getBoundingClientRect();
        return {
          id: el.id || `section-${i}`,
          name: el.tagName.toLowerCase() + (el.className ? `.${el.className.split(' ')[0]}` : ''),
          outline: {
             name: el.tagName.toLowerCase(),
             type: 'element',
             text: (el as HTMLElement).innerText?.slice(0, 100),
          },
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          screenshotPath: '',
        };
      });

      return {
        designTokens: {
          colors: Array.from(colors).slice(0, 10),
          fonts: Array.from(fonts).slice(0, 5),
          spacing: Array.from(spacings).slice(0, 5),
          borderRadius: Array.from(radii).slice(0, 5),
        },
        sections,
      };
    });

    // Take screenshots (mock for now, we'll need to save them to disk in the action)
    // In a real implementation, we would call page.screenshot() here.
    // For the purpose of this task, I'll return the metadata and the action will handle saving.
    
    spec.referenceContext = context;
    
    // Basic extraction for spec headings and notes (from existing url.ts logic)
    const headings = await page.evaluate(() => 
      Array.from(document.querySelectorAll('h1, h2, h3')).map(h => `${h.tagName.toLowerCase()}: ${(h as HTMLElement).innerText.slice(0, 120)}`).slice(0, 20)
    );
    spec.headings = headings;

    return spec;
  } finally {
    await browser.close();
  }
}
