import { head, put } from '@vercel/blob';

export default async function handler(req, res) {
  const filename = 'counter.json';

  try {
    let currentCount = 0;

    try {
      const fileData = await head(filename);
      const response = await fetch(fileData.url);
      const json = await response.json();
      currentCount = json.count;
    } catch (e) {
      currentCount = 4832;
    }

    const newCount = currentCount + 1;

    await put(filename, JSON.stringify({ count: newCount }), {
      access: 'public',
      addRandomSuffix: false, 
    });

    return res.status(200).json({ count: newCount });
  } catch (error) {
    console.error('Blob Storage Error:', error);
    return res.status(500).json({ count: 4832 });
  }
}
