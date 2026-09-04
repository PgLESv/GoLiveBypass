import {spawnSync} from "node:child_process";
import {open} from "node:fs/promises";

const LOG_ANCHOR_BYTES = 512;

function validarJanela(janela) {
  const tamanho = Number(janela?.tamanho);
  const inicio = Number(janela?.inicio);
  const bytes = Buffer.from(janela?.bytes ?? []);
  if (!Number.isSafeInteger(tamanho) || tamanho < 0 ||
      !Number.isSafeInteger(inicio) || inicio < 0 || inicio > tamanho ||
      bytes.length !== tamanho - inicio) {
    throw new Error("leitor de log devolveu uma janela de bytes inconsistente");
  }
  return {tamanho, inicio, bytes};
}

// inicio=null pede apenas a cauda necessaria para criar a marca d'agua. Nas
// atualizacoes le somente ancora+bytes novos, nao o arquivo historico inteiro.
export function criarLeitorLogArquivo(path) {
  return async inicio => {
    let handle;
    try {
      handle = await open(path, "r");
    } catch (error) {
      if (error?.code === "ENOENT") return {tamanho: 0, inicio: 0, bytes: Buffer.alloc(0)};
      throw error;
    }
    try {
      const tamanho = Number((await handle.stat()).size);
      const pedido = inicio === null
        ? Math.max(0, tamanho - LOG_ANCHOR_BYTES)
        : Math.min(tamanho, Math.max(0, Number(inicio)));
      const bytes = Buffer.alloc(tamanho - pedido);
      let lidos = 0;
      while (lidos < bytes.length) {
        const resultado = await handle.read(bytes, lidos, bytes.length - lidos, pedido + lidos);
        if (resultado.bytesRead === 0) break;
        lidos += resultado.bytesRead;
      }
      if (lidos !== bytes.length) throw new Error("log mudou de tamanho durante a leitura");
      return {tamanho, inicio: pedido, bytes};
    } finally {
      await handle.close();
    }
  };
}

// Mantem uma marca d'agua em bytes, em vez de tentar correlacionar relogios de
// maquinas/fusos diferentes. A ancora cobre o corte in-place que o bypass faz
// ao atingir MAX_LOG_BYTES: se o arquivo encolher, retomamos logo depois dos
// ultimos bytes que ja vimos; se for substituido, todo o arquivo novo conta.
export class CapturaLogBytes {
  static async iniciar(lerJanela) {
    const inicial = validarJanela(await lerJanela(null));
    return new CapturaLogBytes(lerJanela, inicial);
  }

  constructor(lerJanela, inicial) {
    this.lerJanela = lerJanela;
    this.offset = inicial.tamanho;
    this.ancora = Buffer.from(inicial.bytes.subarray(Math.max(0, inicial.bytes.length - LOG_ANCHOR_BYTES)));
    this.novos = [];
  }

  async atualizar() {
    const pedido = Math.max(0, this.offset - this.ancora.length);
    let janela = validarJanela(await this.lerJanela(pedido));
    let inicioNovo = this.offset - janela.inicio;
    let precisaArquivoNovo = inicioNovo < 0 || inicioNovo > janela.bytes.length;

    if (!precisaArquivoNovo && this.ancora.length > 0) {
      const posicaoAncora = this.offset - this.ancora.length - janela.inicio;
      const confere = posicaoAncora >= 0 &&
        posicaoAncora + this.ancora.length <= janela.bytes.length &&
        janela.bytes.subarray(posicaoAncora, posicaoAncora + this.ancora.length).equals(this.ancora);
      if (!confere) {
        const sobreposicao = janela.bytes.lastIndexOf(this.ancora);
        if (sobreposicao === -1) precisaArquivoNovo = true;
        else inicioNovo = sobreposicao + this.ancora.length;
      }
    }

    // Truncamento/rotacao pode mover a ancora para antes da janela pedida. So
    // nesse caso raro le o arquivo atual desde zero para recuperar a emenda.
    if (precisaArquivoNovo) {
      janela = validarJanela(await this.lerJanela(0));
      const sobreposicao = this.ancora.length > 0 ? janela.bytes.lastIndexOf(this.ancora) : -1;
      inicioNovo = sobreposicao === -1 ? 0 : sobreposicao + this.ancora.length;
    }

    // Copia so o delta; subarray manteria o renderer_js.log inteiro (varios MB)
    // vivo na memoria para cada ciclo.
    if (inicioNovo < janela.bytes.length) {
      this.novos.push(Buffer.from(janela.bytes.subarray(inicioNovo)));
    }
    this.offset = janela.tamanho;
    this.ancora = Buffer.from(janela.bytes.subarray(Math.max(0, janela.bytes.length - LOG_ANCHOR_BYTES)));
    return this.bytes();
  }

  bytes() {
    return Buffer.concat(this.novos);
  }

  texto() {
    return this.bytes().toString("utf8");
  }
}

function powershellEncoded(script) {
  return Buffer.from(script, "utf16le").toString("base64");
}

function decodificarBase64Estrito(value) {
  if (value.length % 4 !== 0) return null;
  const bytes = Buffer.from(value, "base64");
  // Buffer.from e permissivo e ignora lixo. O round-trip torna a validacao
  // estrita sem uma regexp gigante (que estoura a pilha em logs de muitos MB).
  return bytes.toString("base64") === value ? bytes : null;
}

// Le o arquivo da VM como bytes exatos. PowerShell devolve base64 para que
// CRLF, UTF-8 e o transporte SSH nao mudem os offsets entre duas leituras.
export function criarLeitorLogWindowsSsh({host, password, path, timeoutMs = 20_000}) {
  if (!host || !path) throw new Error("host e path do log do viewer sao obrigatorios");
  const path64 = Buffer.from(path, "utf8").toString("base64");
  return async inicio => {
    const pedido = inicio === null ? -1 : Number(inicio);
    if (!Number.isSafeInteger(pedido) || pedido < -1) throw new Error("offset de log invalido");
    const script = [
      "$ErrorActionPreference='Stop'",
      `$p=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${path64}'))`,
      `$pedido=[long]${pedido}`,
      "if(![IO.File]::Exists($p)){[Console]::Out.Write('0|0|')}else{",
      "$f=[IO.File]::Open($p,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite)",
      "try{$len=$f.Length;$start=if($pedido -lt 0){[Math]::Max([long]0,$len-512)}else{[Math]::Min($len,$pedido)}",
      "$count=[int]($len-$start);$b=[byte[]]::new($count);$read=0;$f.Position=$start",
      "while($read -lt $count){$n=$f.Read($b,$read,$count-$read);if($n -eq 0){break};$read+=$n}",
      "if($read -ne $count){throw 'log mudou de tamanho durante a leitura'}",
      "[Console]::Out.Write($len.ToString()+'|'+$start.ToString()+'|'+[Convert]::ToBase64String($b))",
      "}finally{$f.Dispose()}}",
    ].join(";");
    const remote = [
      "ssh",
      "-o", "BatchMode=no",
      "-o", "ConnectTimeout=8",
      "-o", "StrictHostKeyChecking=no",
      host,
      "powershell", "-NoLogo", "-NoProfile", "-NonInteractive",
      "-EncodedCommand", powershellEncoded(script),
    ];
    const executable = password ? "sshpass" : remote[0];
    const args = password ? ["-e", ...remote] : remote.slice(1);
    const env = password ? {...process.env, SSHPASS: password} : process.env;
    const result = spawnSync(executable, args, {
      encoding: "utf8",
      env,
      timeout: timeoutMs,
      maxBuffer: 64 * 1024 * 1024,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(`nao consegui ler renderer_js.log do viewer: ${(result.stderr || result.stdout || "ssh falhou").trim().slice(0, 300)}`);
    }
    const saida = result.stdout.trim();
    const primeiro = saida.indexOf("|");
    const segundo = saida.indexOf("|", primeiro + 1);
    const tamanho = Number(saida.slice(0, primeiro));
    const inicioReal = Number(saida.slice(primeiro + 1, segundo));
    const bytes = decodificarBase64Estrito(saida.slice(segundo + 1));
    if (bytes === null) {
      throw new Error("viewer devolveu renderer_js.log em formato inesperado");
    }
    return validarJanela({tamanho, inicio: inicioReal, bytes});
  };
}

export function contarMarcador(log, marcador) {
  return String(log).split(/\r?\n/).filter(linha => linha.includes(marcador)).length;
}

function objetoJsonDepoisDoMarcador(linha, marcador) {
  const marcadorEm = linha.indexOf(marcador);
  const inicio = linha.indexOf("{", marcadorEm + marcador.length);
  if (marcadorEm === -1 || inicio === -1) return null;
  let profundidade = 0;
  let string = false;
  let escape = false;
  for (let i = inicio; i < linha.length; i++) {
    const char = linha[i];
    if (string) {
      if (escape) escape = false;
      else if (char === "\\") escape = true;
      else if (char === '"') string = false;
      continue;
    }
    if (char === '"') string = true;
    else if (char === "{") profundidade++;
    else if (char === "}" && --profundidade === 0) {
      try { return JSON.parse(linha.slice(inicio, i + 1)); } catch { return null; }
    }
  }
  return null;
}

export function workerGatewayResumos(log) {
  const marcador = "GLB_WORKER_GW";
  const resumos = [];
  for (const linha of String(log).split(/\r?\n/)) {
    if (!linha.includes(marcador)) continue;
    const payload = objetoJsonDepoisDoMarcador(linha, marcador);
    if (Number.isInteger(payload?.geracao)) resumos.push(payload);
  }
  return resumos;
}

export function workerGatewaysAtivos(log) {
  return workerGatewayResumos(log).filter(payload => payload.geracao >= 1);
}

function campo(linha, nome) {
  const match = linha.match(new RegExp(`(?:^|\\s)${nome}=([^\\s]+)`));
  return match?.[1] ?? null;
}

export function voiceProbes(log) {
  const probes = [];
  for (const linha of String(log).split(/\r?\n/)) {
    if (!linha.includes("voice.probe")) continue;
    const numero = nome => {
      const value = campo(linha, nome);
      return /^\d+$/.test(value || "") ? Number(value) : null;
    };
    probes.push({
      stream: campo(linha, "stream"),
      papel: campo(linha, "papel"),
      fpsIn: numero("fps_in"),
      fpsOut: numero("fps_out"),
      frames: numero("frames"),
      linha,
    });
  }
  return probes;
}

export function senderProbes(log) {
  return voiceProbes(log).filter(probe => probe.papel === "sender");
}

// "Atual" significa a ultima amostra escrita DEPOIS da marca em bytes criada
// para o ciclo. Nunca procura uma amostra positiva antiga para encobrir a mais
// recente com fps_out=0.
export function senderProbeAtual(log) {
  const atual = voiceProbes(log).at(-1);
  return atual?.papel === "sender" ? atual : null;
}

export function progressoSenderAtual(log) {
  const probes = voiceProbes(log);
  const atual = probes.at(-1);
  if (atual?.papel !== "sender") {
    return {atual: null, inicial: null, deltaFrames: null, amostras: 0};
  }
  if (!atual?.stream || atual.frames === null) {
    return {atual: atual ?? null, inicial: null, deltaFrames: null, amostras: 0};
  }
  const mesmas = probes.filter(probe => probe.papel === "sender" &&
    probe.stream === atual.stream && probe.frames !== null);
  const inicial = mesmas[0] ?? null;
  return {
    atual,
    inicial,
    deltaFrames: inicial ? atual.frames - inicial.frames : null,
    amostras: mesmas.length,
  };
}

export function parseRoi(value, largura = 1920, altura = 1080) {
  const partes = String(value).split(",").map(Number);
  if (partes.length !== 4 || partes.some(n => !Number.isInteger(n))) {
    throw new Error("GOLIVE_VIDEO_ROI deve ser x,y,largura,altura");
  }
  const [x, y, width, height] = partes;
  if (x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > largura || y + height > altura) {
    throw new Error(`ROI ${value} fica fora do screenshot ${largura}x${altura}`);
  }
  return {x, y, width, height};
}

export function parseLimiarVisual(value, fallback, nome) {
  const numero = value === undefined || value === "" ? fallback : Number(value);
  if (!Number.isFinite(numero) || numero <= 0 || numero > 1) {
    throw new Error(`${nome} deve ser um numero > 0 e <= 1`);
  }
  return numero;
}

function executarMagick(args, input, maxBuffer = 32 * 1024 * 1024) {
  const result = spawnSync("magick", args, {input, encoding: null, maxBuffer});
  if (result.error) throw new Error(`ImageMagick indisponivel: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`ImageMagick nao decodificou screenshot: ${Buffer.from(result.stderr || "").toString("utf8").trim().slice(0, 240)}`);
  }
  return Buffer.from(result.stdout);
}

export function validarDependenciaVisual() {
  const result = spawnSync("magick", ["-version"], {encoding: "utf8", maxBuffer: 1024 * 1024});
  if (result.error || result.status !== 0 || !result.stdout.includes("ImageMagick")) {
    throw new Error(`preflight visual falhou: ImageMagick (magick) indisponivel${result.error ? `: ${result.error.message}` : ""}`);
  }
}

function dimensoesPng(png) {
  const output = executarMagick(["png:-", "-format", "%w %h", "info:"], png, 1024);
  const match = output.toString("ascii").match(/^(\d+) (\d+)$/);
  if (!match) throw new Error("ImageMagick nao informou as dimensoes do screenshot");
  return {width: Number(match[1]), height: Number(match[2])};
}

function pixelsRoi(png, roi, larguraEsperada, alturaEsperada) {
  const dimensoes = dimensoesPng(png);
  if (dimensoes.width !== larguraEsperada || dimensoes.height !== alturaEsperada) {
    throw new Error(`screenshot ${dimensoes.width}x${dimensoes.height}; esperado ${larguraEsperada}x${alturaEsperada}`);
  }
  const geometry = `${roi.width}x${roi.height}+${roi.x}+${roi.y}`;
  const pixels = executarMagick([
    "png:-", "-crop", geometry, "+repage", "-alpha", "off",
    "-colorspace", "sRGB", "-depth", "8", "rgb:-",
  ], png);
  const esperado = roi.width * roi.height * 3;
  if (pixels.length !== esperado) {
    throw new Error(`ROI decodificada tem ${pixels.length} bytes; esperado ${esperado}`);
  }
  return pixels;
}

export function compararFramesRoi(a, b, {
  roi = parseRoi("840,320,600,330"),
  largura = 1920,
  altura = 1080,
  deltaCanalMinimo = 8,
  proporcaoMinima = 0.01,
  rmseMinimo = 0.002,
  colunas = 8,
  linhas = 6,
  blocosMinimos = 5,
} = {}) {
  if (![colunas, linhas, blocosMinimos].every(Number.isInteger) ||
      colunas <= 0 || linhas <= 0 || blocosMinimos <= 0 || blocosMinimos > colunas * linhas) {
    throw new Error("grade espacial da ROI e invalida");
  }
  const pa = pixelsRoi(a, roi, largura, altura);
  const pb = pixelsRoi(b, roi, largura, altura);
  let pixelsMudaram = 0;
  let somaQuadrados = 0;
  const blocos = new Set();
  for (let i = 0; i < pa.length; i += 3) {
    const dr = Math.abs(pa[i] - pb[i]);
    const dg = Math.abs(pa[i + 1] - pb[i + 1]);
    const db = Math.abs(pa[i + 2] - pb[i + 2]);
    if (Math.max(dr, dg, db) >= deltaCanalMinimo) {
      pixelsMudaram++;
      const pixel = i / 3;
      const x = pixel % roi.width;
      const y = Math.floor(pixel / roi.width);
      const blocoX = Math.min(colunas - 1, Math.floor(x * colunas / roi.width));
      const blocoY = Math.min(linhas - 1, Math.floor(y * linhas / roi.height));
      blocos.add(blocoY * colunas + blocoX);
    }
    somaQuadrados += dr * dr + dg * dg + db * db;
  }
  const totalPixels = roi.width * roi.height;
  const proporcao = pixelsMudaram / totalPixels;
  const rmse = Math.sqrt(somaQuadrados / pa.length) / 255;
  const blocosAlterados = blocos.size;
  return {
    vivo: proporcao >= proporcaoMinima && rmse >= rmseMinimo && blocosAlterados >= blocosMinimos,
    proporcao,
    rmse,
    blocosAlterados,
    blocosMinimos,
    pixelsMudaram,
    totalPixels,
  };
}
