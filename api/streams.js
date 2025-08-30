// Fichier : /api/streams.js (Version corrigée avec les autorisations CORS)

// On définit les constantes du projet
const GAME_ID  = "493959";
const KEYWORDS = ["Layton Valley", "LVRP", "LV RP"];
const LANGUAGE = "fr";
const CACHE_TTL_SECONDS = 120; // 2 minutes

// On crée un cache simple en mémoire pour stocker les données
let cache = {
  data: null,
  timestamp: 0,
};

export default async function handler(request, response) {
  // AJOUT : Bloc pour autoriser votre site web à appeler cette API
  // On autorise spécifiquement votre domaine.
  response.setHeader('Access-Control-Allow-Origin', 'https://laytonvalley.fr');
  response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Si le navigateur envoie une requête de "vérification" (preflight), on répond OK
  if (request.method === 'OPTIONS') {
    return response.status(200).end();
  }
  // FIN DE L'AJOUT

  const now = Date.now();

  if (cache.data && (now - cache.timestamp < CACHE_TTL_SECONDS * 1000)) {
    return response.status(200).json(cache.data);
  }

  try {
    const TWITCH_CLIENT_ID = process.env.TWITCH_CLIENT_ID;
    const TWITCH_CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET;

    const tokenResponse = await fetch('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `client_id=${TWITCH_CLIENT_ID}&client_secret=${TWITCH_CLIENT_SECRET}&grant_type=client_credentials`,
    });
    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;

    if (!accessToken) throw new Error("Impossible d'obtenir l'Access Token de Twitch.");

    const gameResponse = await fetch(`https://api.twitch.tv/helix/games?name=${encodeURIComponent(GAME_ID)}`, {
      headers: { 'Client-ID': TWITCH_CLIENT_ID, 'Authorization': `Bearer ${accessToken}` },
    });
    const gameData = await gameResponse.json();
    const gameId = gameData.data[0]?.id;

    if (!gameId) throw new Error("Jeu non trouvé sur Twitch.");
    
    const streamsResponse = await fetch(`https://api.twitch.tv/helix/streams?game_id=${gameId}&language=${LANGUAGE}&first=100`, {
      headers: { 'Client-ID': TWITCH_CLIENT_ID, 'Authorization': `Bearer ${accessToken}` },
    });
    const streamsData = await streamsResponse.json();
    const allStreams = streamsData.data || [];

    const filteredStreams = allStreams.filter(stream => 
        KEYWORDS.some(kw => stream.title.toLowerCase().includes(kw.toLowerCase()))
    );

    let finalData = filteredStreams;

    if (filteredStreams.length > 0) {
      const userIds = filteredStreams.map(s => `id=${s.user_id}`).join('&');
      const usersResponse = await fetch(`https://api.twitch.tv/helix/users?${userIds}`, {
          headers: { 'Client-ID': TWITCH_CLIENT_ID, 'Authorization': `Bearer ${accessToken}` },
      });
      const usersData = await usersResponse.json();
      const avatars = Object.fromEntries(usersData.data.map(user => [user.id, user.profile_image_url]));
      
      finalData = filteredStreams.map(stream => ({ ...stream, profile_image_url: avatars[stream.user_id] || '' }));
    }
    
    const formattedData = finalData.map(stream => ({
        user_name: stream.user_name,
        viewer_count: stream.viewer_count,
        title: stream.title,
        thumbnail_url: stream.thumbnail_url.replace('{width}', '320').replace('{height}', '180'),
        profile_image_url: stream.profile_image_url,
    }));

    cache = { data: formattedData, timestamp: now };

    return response.status(200).json(formattedData);

  } catch (error) {
    console.error(error);
    return response.status(500).json({ error: error.message });
  }
}







