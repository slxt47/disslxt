import { expect, test } from '@playwright/test';
import { twoUsersInGuild } from '../helpers';

// 1×1 PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

test('share an image and a file; the other member sees and downloads them', async ({ browser }) => {
  const { a, b } = await twoUsersInGuild(browser, 'Dateien');

  await a.page.getByTestId('file-input').setInputFiles([
    { name: 'pixel.png', mimeType: 'image/png', buffer: PNG },
    { name: 'notiz.html', mimeType: 'text/html', buffer: Buffer.from('<script>alert(1)</script>') },
  ]);

  // The image shows as a picture on the other side and actually decodes.
  const img = b.page.getByTestId('file-image').locator('img');
  await expect(img).toBeVisible();
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(1);

  // The HTML file is only a download card, never rendered.
  const card = b.page.getByTestId('file-card');
  await expect(card).toContainText('notiz.html');
  const [download] = await Promise.all([b.page.waitForEvent('download'), card.click()]);
  expect(download.suggestedFilename()).toBe('notiz.html');
  const res = await b.page.request.get((await card.getAttribute('href'))!);
  expect(res.headers()['content-type']).toBe('application/octet-stream');
  expect(res.headers()['content-disposition']).toMatch(/^attachment/);

  // Dropping a file onto the chat shares it as well.
  await a.page.evaluate(async () => {
    const dt = new DataTransfer();
    dt.items.add(new File(['hallo'], 'gezogen.txt', { type: 'text/plain' }));
    const target = document.querySelector('.chat-view')!;
    for (const type of ['dragenter', 'dragover', 'drop']) {
      target.dispatchEvent(
        new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }),
      );
    }
  });
  await expect(b.page.getByTestId('file-card').filter({ hasText: 'gezogen.txt' })).toBeVisible();
  await a.context.close();
  await b.context.close();
});
