import { head, put } from '@vercel/blob';

export default async function handler(req, res) {
  const filename = 'counter.json';
  const fallbackCount = 4832;

  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  try {
    let currentCount = fallbackCount;

    try {
      const fileMeta = await head(filename);
      
      if (fileMeta && fileMeta.url) {
        const blobResponse = await fetch(`${fileMeta.url}?t=${Date.now()}`);
        const json = await blobResponse.json();
        
        if (json && typeof json.count === 'number') {
          currentCount = json.count;
        }
      }
    } catch (blobError) {
      console.log('Blob file missing. Initializing baseline history count.');
      currentCount = fallbackCount;
    }

    const newCount = currentCount + 1;

    await put(filename, JSON.stringify({ count: newCount }), {
      access: 'public',
      addRandomSuffix: false,
    });

    return res.status(200).json({ count: newCount });

  } catch (error) {
    console.error('Fatal Counter Error:', error);
    return res.status(500).json({ count: fallbackCount });
  }
}
