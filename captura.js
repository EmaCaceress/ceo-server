// ----------------- IMPORTS -----------------
import { chromium } from 'playwright';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
// ----------------- CONFIG -----------------
const app = express();
const PORT = 2000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const sesiones = {};
// ----------------- MIDDLEWARE -----------------
app.use(express.json());

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST']
}));

// ----------------- SERVER -----------------
app.listen(PORT, () => {
  console.log(`🚀 Servidor escuchando en http://localhost:${PORT}`);
});

// ----------------- RUTAS -----------------

// Health check
app.get('/', (req, res) => {
  res.send('OK');
});

// Servir imagen
app.get(`/grafica/:user`, (req, res) => {
  const { user } = req.params;
  const sesion = sesiones[user];

  if (!sesion?.imgPath) return res.status(404).json({ error: 'Sin imagen' });
  
  res.sendFile(sesion.imgPath);
});

// Refrescar imagen
app.post('/refrescar', async (req, res) => {
  const { URL, nodoType, frecuencia, username } = req.body;
  console.log('-------------------------------');
  console.log('🔄 Solicitud de refresco recibida');
  
  // Inicializar sesión si no existe
  if (!sesiones[username]) {
    sesiones[username] = { imgPath: null, capturando: false };
  }

  const sesion = sesiones[username];

  if (sesion.capturando) return res.status(429).json({ msg: 'Captura en progreso' });
  sesion.capturando = true;

  try {

    // -------------- INICIO PLAYWRIGHT --------------
    async function capturar() {
      if (!URL || URL === "undefined") {
        console.error('❌ URL no proporcionada');
        return null;
      }
      console.log("Capturando URL:", URL, "Tipo:", nodoType, "Frecuencia:", frecuencia);
      let browser;

      try {
        console.log('📸 Capturando...', new Date().toLocaleString());

        browser = await chromium.launch({ headless: true });

        const context = await browser.newContext({
          viewport: { width: 1920, height: 1080 },
          ignoreHTTPSErrors: true
        });

        const page = await context.newPage();

        await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 10000 });
        await page.waitForTimeout(3000);

        // const nodoNameRaw = (await page.locator('#module span[title]').textContent()).split(" ")[0];
        // const nodoName = nodoNameRaw?.split(" ")[0] || "grafica";

        // ----------- CONFIG SEGÚN TIPO -----------

        if (nodoType === "LEGACY") {
          await page.locator('.control-panel').click();
          await page.locator('#mat-checkbox-7').click();

          const input = page.locator('.mat-form-field').nth(1).locator('input');
          await input.fill('');
          await input.type(frecuencia, { delay: 100 });
          await input.press('Enter');

        } else if (nodoType === "RPHY") {
          const input = page.locator('.mat-form-field').nth(0).locator('input');
          await input.fill('');
          await input.type(frecuencia, { delay: 100 });
          await input.press('Enter');

        } else {
          console.error('❌ Tipo de nodo inválido');
          return null;
        }

        // ----------- SCREENSHOT -----------

        const fileName = `${username}.png`;
        const filePath = path.join(__dirname, fileName);
        
        await page.screenshot({
          path: filePath,
          fullPage: true
        });

        console.log('✅ Captura completada:', fileName);

        return filePath;

      } catch (e) {
        console.error('❌ Error capturando:', e.message);
        return null;

      } finally {
        if (browser) await browser.close();
      }
    }
    // --------------- FIN PLAYWRIGHT ----------------

    sesion.imgPath = await capturar();

    if (sesion.imgPath) {
      res.status(200).json( sesion.imgPath );
    }else {
      res.status(400).json({ error: 'No se pudo capturar' });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    sesion.capturando = false;
  }
});

// ----------------- INIT -----------------

(async () => {
  console.log('🚀 Inicializando...');
})();