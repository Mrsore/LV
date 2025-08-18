// Fichier : /streams.js

// On définit les constantes du projet
const GAME_NAME = "Red Dead Redemption 2";
const KEYWORDS = ["Layton Valley", "LVRP", "LV RP"];
const LANGUAGE = "fr";
const CACHE_TTL_SECONDS = 120; // 2 minutes de cache

// On crée un cache simple en mémoire pour stocker les données
let cache = {
  data: null,
  timestamp: 0,
};

// C'est la fonction principale qui sera exécutée par Vercel
export default async function handler(request, response) {
  const now = Date.now();

  // 1. Vérifier le cache
  if (cache.data && (now - cache.timestamp < CACHE_TTL_SECONDS * 1000)) {
    return response.status(200).json(cache.data);
  }

  try {
    // --- Logique pour appeler Twitch ---
    const TWITCH_CLIENT_ID = process.env.TWITCH_CLIENT_ID;
    const TWITCH_CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET;

    // Étape A: Obtenir un Access Token
    const tokenResponse = await fetch('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `client_id=${TWITCH_CLIENT_ID}&client_secret=${TWITCH_CLIENT_SECRET}&grant_type=client_credentials`,
    });
    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;

    if (!accessToken) throw new Error("Impossible d'obtenir l'Access Token de Twitch.");

    // Étape B: Obtenir l'ID du jeu
    const gameResponse = await fetch(`https://api.twitch.tv/helix/games?name=${encodeURIComponent(GAME_NAME)}`, {
      headers: { 'Client-ID': TWITCH_CLIENT_ID, 'Authorization': `Bearer ${accessToken}` },
    });
    const gameData = await gameResponse.json();
    const gameId = gameData.data[0]?.id;

    if (!gameId) throw new Error("Jeu non trouvé sur Twitch.");
    
    // Étape C: Obtenir les streams
    const streamsResponse = await fetch(`https://api.twitch.tv/helix/streams?game_id=${gameId}&language=${LANGUAGE}&first=100`, {
      headers: { 'Client-ID': TWITCH_CLIENT_ID, 'Authorization': `Bearer ${accessToken}` },
    });
    const streamsData = await streamsResponse.json();
    const allStreams = streamsData.data || [];

    // Étape D: Filtrer les streams
    const filteredStreams = allStreams.filter(stream => 
        KEYWORDS.some(kw => stream.title.toLowerCase().includes(kw.toLowerCase()))
    );

    let finalData = filteredStreams;

    // Étape E: Obtenir les avatars (si des streams ont été trouvés)
    if (filteredStreams.length > 0) {
      const userIds = filteredStreams.map(s => `id=${s.user_id}`).join('&');
      const usersResponse = await fetch(`https://api.twitch.tv/helix/users?${userIds}`, {
          headers: { 'Client-ID': TWITCH_CLIENT_ID, 'Authorization': `Bearer ${accessToken}` },
      });
      const usersData = await usersResponse.json();
      const avatars = Object.fromEntries(usersData.data.map(user => [user.id, user.profile_image_url]));
      
      finalData = filteredStreams.map(stream => ({ ...stream, profile_image_url: avatars[stream.user_id] || '' }));
    }
    
    // Étape F: Formater pour le frontend
    const formattedData = finalData.map(stream => ({
        user_name: stream.user_name,
        viewer_count: stream.viewer_count,
        title: stream.title,
        thumbnail_url: stream.thumbnail_url.replace('{width}', '320').replace('{height}', '180'),
        profile_image_url: stream.profile_image_url,
    }));

    // Mettre à jour le cache
    cache = {
      data: formattedData,
      timestamp: now,
    };

    return response.status(200).json(formattedData);

  } catch (error) {
    console.error(error);
    return response.status(500).json({ error: error.message });
  }

}
