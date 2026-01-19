
import dotenv from 'dotenv';
import fs from 'fs';
dotenv.config({ path: '.env.local' });

const apiKey = process.env.VITE_GOOGLE_TTS_API_KEY;

async function checkVoices() {
    try {
        let output = 'Checking for any es-MX voices (Requesting ALL voices)...\n';
        const url = `https://texttospeech.googleapis.com/v1/voices?key=${apiKey}`;
        console.log('Fetching URL:', url);
        const response = await fetch(url);

        if (!response.ok) {
            console.error('API Error:', await response.text());
            return;
        }

        const data = await response.json();

        if (data.voices) {
            const mxVoices = data.voices.filter(v => v.languageCodes.some(code => code.includes('es-MX')) || v.name.startsWith('es-MX'));

            if (mxVoices.length === 0) {
                output += 'NO es-MX voices found in API response!\n';
                console.warn('NO es-MX voices found!');
            } else {
                mxVoices.forEach(v => {
                    output += `VOICE: ${v.name} | GENDER: ${v.ssmlGender} | LANGS: ${v.languageCodes.join(',')}\n`;
                });
                console.log(`Found ${mxVoices.length} es-MX voices.`);
            }
        }
        fs.writeFileSync('voices_mx_check.txt', output);
        console.log('Done writing to voices_mx_check.txt');
    } catch (e) {
        console.error(e);
    }
}

checkVoices();
