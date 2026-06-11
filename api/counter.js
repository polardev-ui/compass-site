export default async function handler(req, res) {
  try {
    const url = 'https://hits.seeyoufarm.com/api/count/incr/badge.json?url=https://play.wsgpolar.tech';
    const apiResponse = await fetch(url);
    
    if (!apiResponse.ok) throw new Error('API wrapper failed');
    
    const data = await apiResponse.json();
    
    return res.status(200).json({ count: data.value });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ count: 1 }); 
  }
}
