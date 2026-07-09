// weather.js — clima real via Geolocation + Open-Meteo
// Fallback a IP-geolocation si el usuario deniega el permiso

async function getCoords() {
  // Intento 1: geolocalización precisa del browser
  if (navigator.geolocation) {
    try {
      const pos = await new Promise((ok, err) =>
        navigator.geolocation.getCurrentPosition(ok, err, { timeout: 6000, maximumAge: 300_000 })
      );
      return { lat: pos.coords.latitude, lon: pos.coords.longitude };
    } catch (_) {}
  }
  // Intento 2: IP-geolocation (sin permiso, menos precisa pero funciona)
  const r = await fetch('https://ipapi.co/json/');
  if (!r.ok) throw new Error(`ipapi ${r.status}`);
  const geo = await r.json();
  if (!geo.latitude) throw new Error('no location');
  return { lat: geo.latitude, lon: geo.longitude };
}

export async function fetchCurrentWeather() {
  const { lat, lon } = await getCoords();
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}`
    + `&current=temperature_2m,weather_code&timezone=auto&forecast_days=1`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`open-meteo ${r.status}`);
  const data = await r.json();
  if (!data?.current) throw new Error('open-meteo: sin datos current');
  return {
    temp:        data.current.temperature_2m,
    weatherCode: data.current.weather_code,
    lat, lon,
  };
}
