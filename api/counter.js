import { head, put, get } from '@vercel/blob';

export default async function handler(req, res) {
  const filename = 'counter.json';
  const fallbackCount = 4832; 

  try {
    let currentCount = fallbackCount;

    try {
      const fileMeta = await head(filename);
      
      if (fileMeta && fileMeta.url) {
        const blobResponse = await get(fileMeta.url);
        const json = await blobResponse.json();
        
        if (json && typeof json.count === 'number') {
          currentCount = json.count;
        }
      }
    } catch (blobError) {
      console.log('Blob file not found or unreadable. Initializing baseline history count.');
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
    return res.status(200).json({ count: fallbackCount });
  }
}
