export const VERSION = '6.3.1';
export const BUILD_DATE = '2025-01-17';

export const PROMOCODE = 'VITRINA2025'; // временно продублируем

/**
 * Динамическая загрузка конфига
 * (App Shell ожидает config.json в корне Public)
 */
export async function loadConfig() {
  let data = null;
  try {
    const r = await fetch('./config.json', {cache: 'no-cache'});
    data = await r.json();
  } catch (e) {
    data = {
      albumName: 'Между Злом и Добром',
      artist: 'Витрина Разбита',
      albumYear: 2025,
      tracks: [],
      socials: [],
      promoCode: PROMOCODE,
      donateLink: '#'
    }
  }
  return data;
}
