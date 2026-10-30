import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Fingerprint,
  Download,
  Settings,
  WifiOff,
  UserCheck,
  Skull,
  FileText,
  Camera,
  Upload,
  Contact2,
  FolderOpen,
  Folder,
  FolderKanban,
  FolderSearch,
  CloudUpload,
  HardDriveDownload,
  Share2,
  RotateCcw,
  RotateCw,
  X,
  Trash2,
  FileCheck2,
  FileImage,
  FileSearch,
  Sparkles,
  Image as ImageIcon,
  ScanLine,
  CheckCircle2,
  AlertCircle,
  PlusCircle,
  Search,
  ChevronRight,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';

type Modalidade = 'CONFRONTO' | 'NECRO';
type Categoria = 'GUIA' | 'FICHA_PADRAO' | 'DIGITAL';
type Aba = 'COLETA' | 'HISTORICO';
type FiltroScanner = 'PB' | 'COR' | 'ORIGINAL';
type SaidaScanner = 'PDF' | 'JPG';

interface AnexoItem {
  id: number;
  file: File;
  nomeArquivo: string;
  url: string;
  previewImgUrl?: string;
  categoria: Categoria;
  isPdf: boolean;
  tamanhoKb: string;
}

interface ArquivoPersistido {
  nome: string;
  mimeType: string;
  base64: string;
  categoria: Categoria;
  tamanhoKb?: string;
}

interface RegistroAtendimento {
  id: number;
  data: string; // DD-MM-AAAA
  hora?: string;
  modalidade: Modalidade;
  nome: string;
  nomeCaso?: string;
  guia: string;
  bo: string;
  obs: string;
  arquivos: ArquivoPersistido[];
  enviadoDrive: boolean;
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

declare global {
  interface Window {
    jspdf?: {
      jsPDF: new (options?: {
        orientation?: 'p' | 'l';
        unit?: string;
        format?: string;
        compress?: boolean;
      }) => {
        internal: {
          pageSize: {
            getWidth: () => number;
            getHeight: () => number;
          };
        };
        addImage: (
          imageData: string,
          format: string,
          x: number,
          y: number,
          w: number,
          h: number,
          alias?: string,
          compression?: string
        ) => void;
        output: (type: 'blob') => Blob;
      };
    };
  }
}

const DB_NAME = 'AFIS_Mobile_DB';
const DB_VERSION = 1;
const STORE_NAME = 'atendimentos';

function abrirBancoLocal(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('data', 'data', { unique: false });
        store.createIndex('nome', 'nome', { unique: false });
      }
    };
    request.onsuccess = (e) => resolve((e.target as IDBOpenDBRequest).result);
    request.onerror = (e) => reject((e.target as IDBOpenDBRequest).error);
  });
}

async function salvarRegistroIndexedDB(registro: RegistroAtendimento): Promise<RegistroAtendimento> {
  const db = await abrirBancoLocal();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put(registro);
    tx.oncomplete = () => {
      db.close();
      resolve(registro);
    };
    tx.onerror = (e) => {
      db.close();
      reject((e.target as IDBTransaction).error);
    };
  });
}

async function listarRegistrosIndexedDB(): Promise<RegistroAtendimento[]> {
  const db = await abrirBancoLocal();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    req.onsuccess = () => {
      db.close();
      const lista = ((req.result as RegistroAtendimento[]) || []).sort((a, b) => b.id - a.id);
      resolve(lista);
    };
    req.onerror = (e) => {
      db.close();
      reject((e.target as IDBRequest).error);
    };
  });
}

async function removerRegistroIndexedDB(id: number): Promise<void> {
  const db = await abrirBancoLocal();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.delete(id);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = (e) => {
      db.close();
      reject((e.target as IDBTransaction).error);
    };
  });
}

function base64ParaBlob(base64: string, mimeType: string): Blob {
  const byteCharacters = atob(base64);
  const byteArrays: Uint8Array[] = [];
  for (let offset = 0; offset < byteCharacters.length; offset += 512) {
    const slice = byteCharacters.slice(offset, offset + 512);
    const byteNumbers = new Array(slice.length);
    for (let i = 0; i < slice.length; i++) {
      byteNumbers[i] = slice.charCodeAt(i);
    }
    byteArrays.push(new Uint8Array(byteNumbers));
  }
  return new Blob(byteArrays, { type: mimeType });
}

// Binarização / Equalização Adaptativa com Integral Image (Remoção de Sombras em Canvas 2D Offscreen)
function aplicarFiltroDocumentoNoCanvas(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  modo: FiltroScanner
) {
  const imgData = ctx.getImageData(0, 0, width, height);
  const data = imgData.data;
  const totalPixels = width * height;

  const lum = new Uint8Array(totalPixels);
  const integral = new Float64Array((width + 1) * (height + 1));

  for (let y = 0; y < height; y++) {
    let somaLinha = 0;
    const rowOffset = y * width;
    const intRowOffset = (y + 1) * (width + 1);
    const prevIntRowOffset = y * (width + 1);

    for (let x = 0; x < width; x++) {
      const idx = (rowOffset + x) * 4;
      const l = Math.round(0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2]);
      lum[rowOffset + x] = l;
      somaLinha += l;
      integral[intRowOffset + x + 1] = integral[prevIntRowOffset + x + 1] + somaLinha;
    }
  }

  const raio = Math.max(16, Math.round(Math.min(width, height) / 28));

  for (let y = 0; y < height; y++) {
    const y1 = Math.max(0, y - raio);
    const y2 = Math.min(height - 1, y + raio);
    const rowOffset = y * width;

    for (let x = 0; x < width; x++) {
      const x1 = Math.max(0, x - raio);
      const x2 = Math.min(width - 1, x + raio);
      const area = (x2 - x1 + 1) * (y2 - y1 + 1);

      const somaLocal =
        integral[(y2 + 1) * (width + 1) + (x2 + 1)] -
        integral[y1 * (width + 1) + (x2 + 1)] -
        integral[(y2 + 1) * (width + 1) + x1] +
        integral[y1 * (width + 1) + x1];

      const mediaFundo = Math.max(1, somaLocal / area);
      const pixelIdx = (rowOffset + x) * 4;
      const l = lum[rowOffset + x];

      if (modo === 'PB') {
        const razao = l / mediaFundo;
        let val: number;
        if (razao > 0.91) {
          val = 255;
        } else {
          val = Math.max(0, Math.min(255, Math.round((razao - 0.52) * 640)));
        }
        data[pixelIdx] = val;
        data[pixelIdx + 1] = val;
        data[pixelIdx + 2] = val;
      } else if (modo === 'COR') {
        const ganho = 250 / Math.max(70, mediaFundo);
        let r = Math.min(255, Math.round(data[pixelIdx] * ganho));
        let g = Math.min(255, Math.round(data[pixelIdx + 1] * ganho));
        let b = Math.min(255, Math.round(data[pixelIdx + 2] * ganho));

        r = Math.max(0, Math.min(255, Math.round((r - 128) * 1.22 + 135)));
        g = Math.max(0, Math.min(255, Math.round((g - 128) * 1.22 + 135)));
        b = Math.max(0, Math.min(255, Math.round((b - 128) * 1.22 + 135)));

        data[pixelIdx] = r;
        data[pixelIdx + 1] = g;
        data[pixelIdx + 2] = b;
      }
    }
  }

  ctx.putImageData(imgData, 0, 0);
}

export default function App() {
  const [abaAtiva, setAbaAtiva] = useState<Aba>('COLETA');
  const [modalidadeAtual, setModalidadeAtual] = useState<Modalidade>('CONFRONTO');
  const [categoriaAtual, setCategoriaAtual] = useState<Categoria>('GUIA');
  const [anexos, setAnexos] = useState<AnexoItem[]>([]);
  const [nome, setNome] = useState('');
  const [guia, setGuia] = useState('');
  const [bo, setBo] = useState('');
  const [obs, setObs] = useState('');

  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [modalConfigOpen, setModalConfigOpen] = useState(false);
  const [driveUrl, setDriveUrl] = useState('');
  const [enviandoDrive, setEnviandoDrive] = useState(false);
  const [salvandoLocal, setSalvandoLocal] = useState(false);
  const [promptInstalacao, setPromptInstalacao] = useState<BeforeInstallPromptEvent | null>(null);
  const [feedback, setFeedback] = useState<{ tipo: 'sucesso' | 'erro'; texto: string } | null>(null);

  // Estado do Scanner de Documentos
  const [scannerAberto, setScannerAberto] = useState(false);
  const [scannerCategoria, setScannerCategoria] = useState<Categoria>('GUIA');
  const [scannerFiltro, setScannerFiltro] = useState<FiltroScanner>('PB');
  const [scannerRotacao, setScannerRotacao] = useState(0);
  const [scannerFormato, setScannerFormato] = useState<SaidaScanner>('PDF');
  const [scannerPreviewUrl, setScannerPreviewUrl] = useState('');
  const [scannerProcessando, setScannerProcessando] = useState(false);
  const [scannerExportando, setScannerExportando] = useState(false);
  const [scannerIndiceEdicao, setScannerIndiceEdicao] = useState<number | null>(null);

  const scannerImgBaseRef = useRef<HTMLImageElement | null>(null);
  const scannerCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Estado do Histórico / Pastas (IndexedDB)
  const [atendimentos, setAtendimentos] = useState<RegistroAtendimento[]>([]);
  const [filtroTexto, setFiltroTexto] = useState('');
  const [filtroDataIso, setFiltroDataIso] = useState('');
  const [pastasDataAbertas, setPastasDataAbertas] = useState<Record<string, boolean>>({});
  const [casoDetalhe, setCasoDetalhe] = useState<RegistroAtendimento | null>(null);
  const [reenviandoCaso, setReenviandoCaso] = useState(false);
  const [confirmandoExclusao, setConfirmandoExclusao] = useState(false);
  const [lightboxArquivo, setLightboxArquivo] = useState<{ nome: string; dataUri: string } | null>(null);

  const inputCameraRef = useRef<HTMLInputElement>(null);
  const inputGaleriaRef = useRef<HTMLInputElement>(null);
  const inputNomeRef = useRef<HTMLInputElement>(null);
  const categoriaRef = useRef<Categoria>('GUIA');

  const carregarHistorico = async () => {
    try {
      const lista = await listarRegistrosIndexedDB();
      setAtendimentos(lista);
    } catch (err) {
      console.warn('Falha ao ler IndexedDB:', err);
    }
  };

  useEffect(() => {
    const urlSalva = localStorage.getItem('afis_drive_webhook_url') || '';
    setDriveUrl(urlSalva);
    carregarHistorico();

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch((err) => {
        console.warn('Falha no Service Worker:', err);
      });
    }

    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setPromptInstalacao(e as BeforeInstallPromptEvent);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  const exibirMensagem = (texto: string, tipo: 'sucesso' | 'erro' = 'erro') => {
    setFeedback({ tipo, texto });
    setTimeout(() => {
      setFeedback((atual) => (atual?.texto === texto ? null : atual));
    }, 4500);
  };

  const instalarApp = async () => {
    if (!promptInstalacao) return;
    await promptInstalacao.prompt();
    const { outcome } = await promptInstalacao.userChoice;
    if (outcome === 'accepted') {
      setPromptInstalacao(null);
    }
  };

  const acionarCamera = (cat: Categoria) => {
    setCategoriaAtual(cat);
    categoriaRef.current = cat;
    if (inputCameraRef.current) {
      inputCameraRef.current.value = '';
      inputCameraRef.current.click();
    }
  };

  const acionarGaleria = (cat: Categoria) => {
    setCategoriaAtual(cat);
    categoriaRef.current = cat;
    if (inputGaleriaRef.current) {
      inputGaleriaRef.current.value = '';
      inputGaleriaRef.current.click();
    }
  };

  const sanitizar = (txt: string) => {
    return String(txt || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .replace(/_+/g, '_')
      .toUpperCase()
      .trim();
  };

  const obterDataAtualDDMMAAAA = () => {
    const agora = new Date();
    const dia = String(agora.getDate()).padStart(2, '0');
    const mes = String(agora.getMonth() + 1).padStart(2, '0');
    const ano = agora.getFullYear();
    return `${dia}-${mes}-${ano}`;
  };

  const gerarNomePadronizado = (cat: Categoria, ext: string, sufixo = '') => {
    const nomeIndividuo = sanitizar(nome || 'INDIVIDUO');
    const dataStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const horaStr = new Date().toTimeString().slice(0, 8).replace(/:/g, '');
    return `${modalidadeAtual}_${nomeIndividuo}_${cat}${sufixo}_${dataStr}_${horaStr}.${ext}`;
  };

  // ==========================================
  // OPERAÇÃO DO SCANNER DE DOCUMENTOS
  // ==========================================
  const executarProcessamentoScanner = (
    img: HTMLImageElement,
    filtro: FiltroScanner,
    rotacao: number
  ) => {
    setScannerProcessando(true);
    requestAnimationFrame(() => {
      setTimeout(() => {
        try {
          const MAX_DIM = 2000;
          let w = img.naturalWidth || img.width;
          let h = img.naturalHeight || img.height;

          if (w > MAX_DIM || h > MAX_DIM) {
            const escala = MAX_DIM / Math.max(w, h);
            w = Math.round(w * escala);
            h = Math.round(h * escala);
          }

          const trocouEixos = rotacao === 90 || rotacao === 270;
          const canvasW = trocouEixos ? h : w;
          const canvasH = trocouEixos ? w : h;

          const canvas = document.createElement('canvas');
          canvas.width = canvasW;
          canvas.height = canvasH;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });

          if (ctx) {
            ctx.save();
            ctx.translate(canvasW / 2, canvasH / 2);
            ctx.rotate((rotacao * Math.PI) / 180);
            ctx.drawImage(img, -w / 2, -h / 2, w, h);
            ctx.restore();

            if (filtro !== 'ORIGINAL') {
              aplicarFiltroDocumentoNoCanvas(ctx, canvasW, canvasH, filtro);
            }
          }

          scannerCanvasRef.current = canvas;
          setScannerPreviewUrl(canvas.toDataURL('image/jpeg', 0.88));
        } catch (err) {
          console.error('Erro no processamento do scanner:', err);
        } finally {
          setScannerProcessando(false);
        }
      }, 20);
    });
  };

  const abrirScannerComArquivo = (file: File, cat: Categoria, indiceExistente: number | null = null) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      scannerImgBaseRef.current = img;
      setScannerCategoria(cat);
      setScannerIndiceEdicao(indiceExistente);
      setScannerRotacao(0);

      const filtroInicial: FiltroScanner = cat === 'DIGITAL' ? 'ORIGINAL' : 'PB';
      const formatoInicial: SaidaScanner = cat === 'DIGITAL' ? 'JPG' : 'PDF';

      setScannerFiltro(filtroInicial);
      setScannerFormato(formatoInicial);
      setScannerAberto(true);
      executarProcessamentoScanner(img, filtroInicial, 0);
    };
    img.src = url;
  };

  const fecharScannerModal = () => {
    setScannerAberto(false);
    scannerImgBaseRef.current = null;
    scannerCanvasRef.current = null;
    setScannerIndiceEdicao(null);
  };

  const alterarFiltroScanner = (novoFiltro: FiltroScanner) => {
    setScannerFiltro(novoFiltro);
    if (scannerImgBaseRef.current) {
      executarProcessamentoScanner(scannerImgBaseRef.current, novoFiltro, scannerRotacao);
    }
  };

  const rotacionarScanner = (delta: number) => {
    const novaRot = (scannerRotacao + delta + 360) % 360;
    setScannerRotacao(novaRot);
    if (scannerImgBaseRef.current) {
      executarProcessamentoScanner(scannerImgBaseRef.current, scannerFiltro, novaRot);
    }
  };

  const confirmarEscaneamento = async () => {
    const canvas = scannerCanvasRef.current;
    if (!canvas) return;

    setScannerExportando(true);
    try {
      const dataUrlJpg = canvas.toDataURL('image/jpeg', 0.95);
      let arquivoFinal: File;
      let nomeFormatado: string;
      let isPdf = false;

      if (scannerFormato === 'PDF' && window.jspdf?.jsPDF) {
        isPdf = true;
        nomeFormatado = gerarNomePadronizado(scannerCategoria, 'pdf');
        const { jsPDF } = window.jspdf;
        const orientacao = canvas.width > canvas.height ? 'l' : 'p';
        const pdf = new jsPDF({
          orientation: orientacao,
          unit: 'mm',
          format: 'a4',
          compress: true,
        });

        const pageW = pdf.internal.pageSize.getWidth();
        const pageH = pdf.internal.pageSize.getHeight();
        const margem = 6;
        const areaW = pageW - margem * 2;
        const areaH = pageH - margem * 2;

        const ratio = Math.min(areaW / canvas.width, areaH / canvas.height);
        const imgW = canvas.width * ratio;
        const imgH = canvas.height * ratio;
        const posX = (pageW - imgW) / 2;
        const posY = (pageH - imgH) / 2;

        pdf.addImage(dataUrlJpg, 'JPEG', posX, posY, imgW, imgH, undefined, 'FAST');
        const pdfBlob = pdf.output('blob');
        arquivoFinal = new File([pdfBlob], nomeFormatado, { type: 'application/pdf' });
      } else {
        isPdf = false;
        nomeFormatado = gerarNomePadronizado(scannerCategoria, 'jpg');
        const blob = await (await fetch(dataUrlJpg)).blob();
        arquivoFinal = new File([blob], nomeFormatado, { type: 'image/jpeg' });
      }

      const objUrl = URL.createObjectURL(arquivoFinal);
      const novoItem: AnexoItem = {
        id: Date.now() + Math.random(),
        file: arquivoFinal,
        nomeArquivo: nomeFormatado,
        url: objUrl,
        previewImgUrl: dataUrlJpg,
        categoria: scannerCategoria,
        isPdf,
        tamanhoKb: Math.max(1, Math.round(arquivoFinal.size / 1024)).toString(),
      };

      setAnexos((prev) => {
        if (scannerIndiceEdicao !== null && prev[scannerIndiceEdicao]) {
          URL.revokeObjectURL(prev[scannerIndiceEdicao].url);
          const copia = [...prev];
          copia[scannerIndiceEdicao] = novoItem;
          return copia;
        }
        return [...prev, novoItem];
      });

      fecharScannerModal();
    } catch (e) {
      console.error('Erro ao exportar documento escaneado:', e);
      exibirMensagem('Erro ao gerar o documento escaneado.', 'erro');
    } finally {
      setScannerExportando(false);
    }
  };

  const aoProcessarArquivos = (
    e: React.ChangeEvent<HTMLInputElement>,
    origem: 'CAMERA' | 'GALERIA' = 'GALERIA'
  ) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const catAtiva = categoriaRef.current || categoriaAtual;
    const listaFiles = Array.from(files);
    const primeiro = listaFiles[0];
    const ehImagem = primeiro.type.startsWith('image/');

    if (
      ehImagem &&
      (origem === 'CAMERA' ||
        (listaFiles.length === 1 && (catAtiva === 'GUIA' || catAtiva === 'FICHA_PADRAO')))
    ) {
      abrirScannerComArquivo(primeiro, catAtiva, null);
      return;
    }

    const novosAnexos: AnexoItem[] = listaFiles.map((origFile, idx) => {
      const isPdf = origFile.type === 'application/pdf' || origFile.name.toLowerCase().endsWith('.pdf');
      const ext = isPdf ? 'pdf' : origFile.name.split('.').pop() || 'jpg';
      const sufixoContador = listaFiles.length > 1 ? `_${idx + 1}` : '';

      const nomeFormatado = gerarNomePadronizado(catAtiva, ext, sufixoContador);
      const fileRenomeado = new File([origFile], nomeFormatado, { type: origFile.type });
      const objUrl = URL.createObjectURL(origFile);

      return {
        id: Date.now() + Math.random(),
        file: fileRenomeado,
        nomeArquivo: nomeFormatado,
        url: objUrl,
        categoria: catAtiva,
        isPdf,
        tamanhoKb: (origFile.size / 1024).toFixed(0),
      };
    });

    setAnexos((prev) => [...prev, ...novosAnexos]);
  };

  const removerAnexo = (idx: number) => {
    setAnexos((prev) => {
      const alvo = prev[idx];
      if (alvo) URL.revokeObjectURL(alvo.url);
      return prev.filter((_, i) => i !== idx);
    });
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const resultStr = String(reader.result || '');
        const base64String = resultStr.split(',')[1] || '';
        resolve(base64String);
      };
      reader.onerror = (error) => reject(error);
    });
  };

  const limparTudo = () => {
    anexos.forEach((a) => URL.revokeObjectURL(a.url));
    setAnexos([]);
    setNome('');
    setGuia('');
    setBo('');
    setObs('');
  };

  const montarRegistroAtendimento = async (enviadoDriveStatus: boolean): Promise<RegistroAtendimento> => {
    const nomeUpper = nome.trim().toUpperCase();
    const guiaVal = guia.trim() || 'S/N';
    const boVal = bo.trim() || 'S/N';
    const obsVal = obs.trim() || 'Sem observações';

    const listaArquivos: ArquivoPersistido[] = [];
    for (const item of anexos) {
      const b64 = await fileToBase64(item.file);
      listaArquivos.push({
        nome: item.nomeArquivo,
        mimeType: item.file.type || (item.isPdf ? 'application/pdf' : 'image/jpeg'),
        base64: b64,
        categoria: item.categoria,
        tamanhoKb: item.tamanhoKb,
      });
    }

    return {
      id: Date.now(),
      data: obterDataAtualDDMMAAAA(),
      hora: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
      modalidade: modalidadeAtual,
      nome: nomeUpper,
      nomeCaso: sanitizar(nomeUpper),
      guia: guiaVal,
      bo: boVal,
      obs: obsVal,
      arquivos: listaArquivos,
      enviadoDrive: enviadoDriveStatus,
    };
  };

  const salvarAtendimentoApenasLocal = async () => {
    const nomeTrim = nome.trim();
    if (!nomeTrim) {
      exibirMensagem('Informe o nome do periciando / cadáver.', 'erro');
      inputNomeRef.current?.focus();
      return;
    }
    if (anexos.length === 0) {
      exibirMensagem('Adicione ao menos uma foto ou documento em PDF.', 'erro');
      return;
    }

    setSalvandoLocal(true);
    try {
      const registro = await montarRegistroAtendimento(false);
      await salvarRegistroIndexedDB(registro);
      await carregarHistorico();
      exibirMensagem('Atendimento salvo na memória do aparelho! Consulte a aba "Histórico / Pastas".', 'sucesso');
      limparTudo();
    } catch (e) {
      console.error(e);
      exibirMensagem('Erro ao salvar registro no armazenamento local.', 'erro');
    } finally {
      setSalvandoLocal(false);
    }
  };

  const enviarParaGoogleDrive = async () => {
    const webhookUrl = localStorage.getItem('afis_drive_webhook_url');
    if (!webhookUrl) {
      setModalConfigOpen(true);
      exibirMensagem('Configure primeiro a URL do seu Google Apps Script na engrenagem.', 'erro');
      return;
    }

    const nomeTrim = nome.trim();
    if (!nomeTrim) {
      exibirMensagem('Informe o nome do periciando / cadáver.', 'erro');
      inputNomeRef.current?.focus();
      return;
    }

    if (anexos.length === 0) {
      exibirMensagem('Adicione ao menos uma foto ou documento em PDF.', 'erro');
      return;
    }

    setEnviandoDrive(true);

    try {
      const registro = await montarRegistroAtendimento(false);
      await salvarRegistroIndexedDB(registro);

      const dataHora = new Date().toLocaleString('pt-BR');
      const metadadosTexto = `ATENDIMENTO PERICIAL DE CAMPO:\nModalidade: ${registro.modalidade}\nPericiando/Cadáver: ${registro.nome}\nGuia/Ofício: ${registro.guia}\nBoletim de Ocorrência (BO): ${registro.bo}\nData/Hora Coleta: ${dataHora}\nObservações: ${registro.obs}\nTotal de Arquivos: ${registro.arquivos.length}`;

      const payload = {
        modalidade: registro.modalidade,
        nomeCaso: registro.nomeCaso || sanitizar(registro.nome),
        metadados: metadadosTexto,
        arquivos: registro.arquivos.map((a) => ({
          nome: a.nome,
          mimeType: a.mimeType,
          base64: a.base64,
        })),
      };

      await fetch(webhookUrl, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload),
      });

      registro.enviadoDrive = true;
      await salvarRegistroIndexedDB(registro);
      await carregarHistorico();

      exibirMensagem('Envio concluído e cópia arquivada no aparelho! Verifique a pasta "AFIS_CAMPO" no Drive.', 'sucesso');
      limparTudo();
    } catch (err) {
      console.error(err);
      await carregarHistorico();
      exibirMensagem('Sem conexão com o Drive. O atendimento foi salvo em "Histórico / Pastas" para reenvio posterior.', 'erro');
      limparTudo();
    } finally {
      setEnviandoDrive(false);
    }
  };

  const enviarCompartilhamentoNativo = async () => {
    const nomeTrim = nome.trim();
    if (!nomeTrim) {
      exibirMensagem('Informe o nome do periciando / cadáver.', 'erro');
      return;
    }
    if (anexos.length === 0) {
      exibirMensagem('Adicione ao menos uma foto ou documento.', 'erro');
      return;
    }

    const guiaVal = guia.trim() || 'S/N';
    const boVal = bo.trim() || 'S/N';
    const tituloAssunto = `[AFIS] ${modalidadeAtual} - ${nomeTrim.toUpperCase()}`;
    const textoCorpo = `Atendimento Pericial (${modalidadeAtual}):\n- Periciando: ${nomeTrim.toUpperCase()}\n- Guia: ${guiaVal} | BO: ${boVal}\n- Arquivos: ${anexos.length} anexo(s)`;

    const arquivosParaEnvio = anexos.map((a) => a.file);

    if (navigator.canShare && navigator.canShare({ files: arquivosParaEnvio })) {
      try {
        await navigator.share({
          title: tituloAssunto,
          text: textoCorpo,
          files: arquivosParaEnvio,
        });
      } catch (e: unknown) {
        if (e instanceof Error && e.name !== 'AbortError') console.warn(e);
      }
    } else {
      exibirMensagem('Compartilhamento de arquivos não suportado neste navegador. Use o envio para o Google Drive.', 'erro');
    }
  };

  const salvarConfig = () => {
    const url = driveUrl.trim();
    if (url) {
      localStorage.setItem('afis_drive_webhook_url', url);
      setModalConfigOpen(false);
      exibirMensagem('Configuração salva com sucesso!', 'sucesso');
    }
  };

  // ==========================================
  // LÓGICA DO HISTÓRICO / PASTAS
  // ==========================================
  const dataFiltroDDMMAAAA = useMemo(() => {
    if (!filtroDataIso) return '';
    const partes = filtroDataIso.split('-');
    if (partes.length !== 3) return '';
    return `${partes[2]}-${partes[1]}-${partes[0]}`;
  }, [filtroDataIso]);

  const atendimentosFiltrados = useMemo(() => {
    const termo = filtroTexto.trim().toUpperCase();
    return atendimentos.filter((item) => {
      const bateData = !dataFiltroDDMMAAAA || item.data === dataFiltroDDMMAAAA;
      const bateTexto =
        !termo ||
        item.nome.toUpperCase().includes(termo) ||
        item.guia.toUpperCase().includes(termo) ||
        item.bo.toUpperCase().includes(termo);
      return bateData && bateTexto;
    });
  }, [atendimentos, dataFiltroDDMMAAAA, filtroTexto]);

  const gruposPorData = useMemo(() => {
    const grupos: Record<string, RegistroAtendimento[]> = {};
    atendimentosFiltrados.forEach((item) => {
      if (!grupos[item.data]) grupos[item.data] = [];
      grupos[item.data].push(item);
    });
    return grupos;
  }, [atendimentosFiltrados]);

  const filtrarHoje = () => {
    const agora = new Date();
    const yyyy = agora.getFullYear();
    const mm = String(agora.getMonth() + 1).padStart(2, '0');
    const dd = String(agora.getDate()).padStart(2, '0');
    setFiltroDataIso(`${yyyy}-${mm}-${dd}`);
  };

  const abrirArquivoPersistido = (arq: ArquivoPersistido) => {
    const isPdf = arq.mimeType === 'application/pdf' || arq.nome.toLowerCase().endsWith('.pdf');
    if (isPdf) {
      const blob = base64ParaBlob(arq.base64, 'application/pdf');
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.target = '_blank';
      a.rel = 'noopener';
      a.click();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
    } else {
      const dataUri = `data:${arq.mimeType || 'image/jpeg'};base64,${arq.base64}`;
      setLightboxArquivo({ nome: arq.nome, dataUri });
    }
  };

  const reenviarCasoParaDrive = async () => {
    if (!casoDetalhe) return;
    const webhookUrl = localStorage.getItem('afis_drive_webhook_url');
    if (!webhookUrl) {
      setModalConfigOpen(true);
      exibirMensagem('Configure primeiro a URL do seu Google Apps Script na engrenagem.', 'erro');
      return;
    }

    setReenviandoCaso(true);
    try {
      const c = casoDetalhe;
      const metadadosTexto = `ATENDIMENTO PERICIAL DE CAMPO:\nModalidade: ${c.modalidade}\nPericiando/Cadáver: ${c.nome}\nGuia/Ofício: ${c.guia}\nBoletim de Ocorrência (BO): ${c.bo}\nData Coleta: ${c.data} ${c.hora || ''}\nObservações: ${c.obs}\nTotal de Arquivos: ${c.arquivos.length}`;

      const payload = {
        modalidade: c.modalidade,
        nomeCaso: c.nomeCaso || sanitizar(c.nome),
        metadados: metadadosTexto,
        arquivos: c.arquivos.map((a) => ({
          nome: a.nome,
          mimeType: a.mimeType,
          base64: a.base64,
        })),
      };

      await fetch(webhookUrl, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload),
      });

      const atualizado: RegistroAtendimento = { ...c, enviadoDrive: true };
      await salvarRegistroIndexedDB(atualizado);
      await carregarHistorico();
      setCasoDetalhe(atualizado);
      exibirMensagem('Atendimento reenviado com sucesso para o Google Drive!', 'sucesso');
    } catch (e) {
      console.error(e);
      exibirMensagem('Falha ao reenviar para o Google Drive. Verifique sua conexão.', 'erro');
    } finally {
      setReenviandoCaso(false);
    }
  };

  const exportarTodosArquivosCaso = () => {
    if (!casoDetalhe) return;
    casoDetalhe.arquivos.forEach((arq, i) => {
      setTimeout(() => {
        const blob = base64ParaBlob(arq.base64, arq.mimeType || 'application/octet-stream');
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = arq.nome;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 15000);
      }, i * 250);
    });
  };

  const confirmarExclusaoRegistro = async () => {
    if (!casoDetalhe) return;
    await removerRegistroIndexedDB(casoDetalhe.id);
    setConfirmandoExclusao(false);
    setCasoDetalhe(null);
    await carregarHistorico();
    exibirMensagem('Registro local excluído.', 'sucesso');
  };

  return (
    <div className="bg-slate-950 text-slate-100 min-h-screen flex flex-col antialiased selection:bg-blue-600 selection:text-white">
      {/* Topbar + Abas */}
      <header className="bg-slate-900 border-b border-slate-800 sticky top-0 z-40 shadow-md">
        <div className="px-4 py-3 flex justify-between items-center max-w-md mx-auto w-full">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white shadow-md shadow-blue-500/30">
              <Fingerprint className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-sm font-extrabold tracking-tight uppercase flex items-center gap-1">
                AFIS Mobile <span className="text-blue-400">· Campo</span>
              </h1>
              <p className="text-[10px] text-slate-400 font-mono">DPT-BA · Coleta Pericial</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {promptInstalacao && (
              <button
                type="button"
                onClick={instalarApp}
                className="px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold flex items-center gap-1 shadow-md active:scale-95 transition"
              >
                <Download className="w-3.5 h-3.5" /> Instalar
              </button>
            )}
            <a
              href="/afis-mobile.html"
              download="afis-mobile.html"
              className="px-2.5 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 hover:text-white text-[11px] font-semibold flex items-center gap-1 active:scale-95 transition"
              title="Baixar arquivo HTML único atualizado"
            >
              <Download className="w-3.5 h-3.5 text-emerald-400" /> HTML
            </a>
            <button
              type="button"
              onClick={() => setModalConfigOpen(true)}
              className="p-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 hover:text-white active:scale-95 transition"
              title="Configurar Destino"
            >
              <Settings className="w-4 h-4 text-blue-400" />
            </button>
          </div>
        </div>

        {/* Abas de Navegação */}
        <div className="px-4 pb-2.5 max-w-md mx-auto w-full grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setAbaAtiva('COLETA')}
            className={`py-2 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition-all ${
              abaAtiva === 'COLETA'
                ? 'bg-blue-600 text-white shadow-md shadow-blue-600/25'
                : 'bg-slate-800/80 text-slate-300 border border-slate-700/80 hover:text-white'
            }`}
          >
            <PlusCircle className="w-4 h-4" />
            <span>+ Nova Coleta</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setAbaAtiva('HISTORICO');
              carregarHistorico();
            }}
            className={`py-2 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition-all ${
              abaAtiva === 'HISTORICO'
                ? 'bg-blue-600 text-white shadow-md shadow-blue-600/25'
                : 'bg-slate-800/80 text-slate-300 border border-slate-700/80 hover:text-white'
            }`}
          >
            <FolderKanban className="w-4 h-4 text-amber-400" />
            <span>Histórico / Pastas</span>
            <span className="ml-0.5 px-1.5 py-0.2 bg-slate-950 text-amber-400 rounded-full text-[10px] font-mono border border-slate-700">
              {atendimentos.length}
            </span>
          </button>
        </div>
      </header>

      {/* Conteúdo Principal */}
      <main className="flex-1 max-w-md mx-auto w-full p-4 space-y-4">
        {/* Feedback Banner */}
        {feedback && (
          <div
            className={`p-3 rounded-xl border flex items-start justify-between gap-2 text-xs font-medium ${
              feedback.tipo === 'sucesso'
                ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-200'
                : 'bg-rose-500/15 border-rose-500/40 text-rose-200'
            }`}
          >
            <div className="flex items-center gap-2">
              {feedback.tipo === 'sucesso' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
              )}
              <span>{feedback.texto}</span>
            </div>
            <button
              type="button"
              onClick={() => setFeedback(null)}
              className="text-slate-400 hover:text-white"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Banner de Status Offline */}
        {isOffline && (
          <div className="bg-amber-500/10 border border-amber-500/30 p-2.5 rounded-xl flex items-center gap-2 text-amber-300 text-xs font-medium">
            <WifiOff className="w-4 h-4 text-amber-400 flex-shrink-0" />
            <span>
              Você está offline. Os atendimentos serão salvos no banco local do aparelho (IndexedDB).
            </span>
          </div>
        )}

        {abaAtiva === 'COLETA' ? (
          <div className="space-y-4">
            {/* 1. Tipo de Exame */}
            <div className="bg-slate-900 border border-slate-800 p-3 rounded-2xl shadow-sm">
              <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">
                Modalidade Pericial
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setModalidadeAtual('CONFRONTO')}
                  className={`py-2.5 px-3 rounded-xl border-2 flex items-center justify-center gap-2 font-bold text-xs transition-all ${
                    modalidadeAtual === 'CONFRONTO'
                      ? 'bg-blue-600/20 border-blue-500 text-blue-300'
                      : 'bg-slate-800/40 border-slate-700 text-slate-400'
                  }`}
                >
                  <UserCheck className="w-4 h-4" />
                  <span>Confronto (Vivo)</span>
                </button>
                <button
                  type="button"
                  onClick={() => setModalidadeAtual('NECRO')}
                  className={`py-2.5 px-3 rounded-xl border-2 flex items-center justify-center gap-2 font-bold text-xs transition-all ${
                    modalidadeAtual === 'NECRO'
                      ? 'bg-red-600/20 border-red-500 text-red-300'
                      : 'bg-slate-800/40 border-slate-700 text-slate-400'
                  }`}
                >
                  <Skull className="w-4 h-4" />
                  <span>Necropapiloscopia</span>
                </button>
              </div>
            </div>

            {/* 2. Dados do Caso */}
            <div className="bg-slate-900 border border-slate-800 p-3.5 rounded-2xl shadow-sm space-y-3">
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
                  Nome do Periciando / Cadáver *
                </label>
                <input
                  ref={inputNomeRef}
                  type="text"
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  placeholder="NOME COMPLETO"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-sm font-semibold text-white focus:outline-none focus:border-blue-500 uppercase tracking-wide"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
                    Nº Guia / Ofício
                  </label>
                  <input
                    type="text"
                    value={guia}
                    onChange={(e) => setGuia(e.target.value)}
                    placeholder="Ex: 162496/2026"
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500 uppercase"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
                    Nº Ocorrência (BO)
                  </label>
                  <input
                    type="text"
                    value={bo}
                    onChange={(e) => setBo(e.target.value)}
                    placeholder="Ex: 790255/2026"
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500 uppercase"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
                  Observações Rápidas (Opcional)
                </label>
                <input
                  type="text"
                  value={obs}
                  onChange={(e) => setObs(e.target.value)}
                  placeholder="Ex: Dedo com reidratação / coleta no IML"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>

            {/* 3. Captura & Anexo de Arquivos */}
            <div className="bg-slate-900 border border-slate-800 p-3.5 rounded-2xl shadow-sm space-y-3">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                  <ScanLine className="w-4 h-4 text-emerald-400" /> Scanner & Vestígios
                </span>
                <span className="text-[10px] font-mono text-slate-400 bg-slate-800 px-2 py-0.5 rounded-full border border-slate-700">
                  {anexos.length} anexo(s)
                </span>
              </div>

              <div className="space-y-2">
                {/* Categoria GUIA / OFÍCIO */}
                <div className="bg-slate-950 border border-slate-800 rounded-xl p-2 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-blue-500/10 text-blue-400 flex items-center justify-center">
                      <FileText className="w-4 h-4" />
                    </div>
                    <div>
                      <p className="text-xs font-bold text-slate-200">Guia / Ofício</p>
                      <p className="text-[10px] text-slate-400">Scanner A4 (PDF/JPG) ou Anexo</p>
                    </div>
                  </div>
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => acionarCamera('GUIA')}
                      className="px-2.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 active:scale-95 text-white text-[11px] font-semibold flex items-center gap-1 shadow"
                    >
                      <Camera className="w-3.5 h-3.5" /> Câmera
                    </button>
                    <button
                      type="button"
                      onClick={() => acionarGaleria('GUIA')}
                      className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 active:scale-95 text-slate-200 text-[11px] font-semibold flex items-center gap-1"
                    >
                      <Upload className="w-3.5 h-3.5 text-blue-400" /> Arquivo
                    </button>
                  </div>
                </div>

                {/* Categoria FICHA PADRÃO */}
                <div className="bg-slate-950 border border-slate-800 rounded-xl p-2 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center">
                      <Contact2 className="w-4 h-4" />
                    </div>
                    <div>
                      <p className="text-xs font-bold text-slate-200">Ficha Padrão</p>
                      <p className="text-[10px] text-slate-400">Scanner Prontuário / RG (PDF/JPG)</p>
                    </div>
                  </div>
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => acionarCamera('FICHA_PADRAO')}
                      className="px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white text-[11px] font-semibold flex items-center gap-1 shadow"
                    >
                      <Camera className="w-3.5 h-3.5" /> Câmera
                    </button>
                    <button
                      type="button"
                      onClick={() => acionarGaleria('FICHA_PADRAO')}
                      className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 active:scale-95 text-slate-200 text-[11px] font-semibold flex items-center gap-1"
                    >
                      <Upload className="w-3.5 h-3.5 text-emerald-400" /> Arquivo
                    </button>
                  </div>
                </div>

                {/* Categoria DIGITAL / DEDO */}
                <div className="bg-slate-950 border border-slate-800 rounded-xl p-2 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-amber-500/10 text-amber-400 flex items-center justify-center">
                      <Fingerprint className="w-4 h-4" />
                    </div>
                    <div>
                      <p className="text-xs font-bold text-slate-200">Digital / Dedo</p>
                      <p className="text-[10px] text-slate-400">Macro ou foto da galeria</p>
                    </div>
                  </div>
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => acionarCamera('DIGITAL')}
                      className="px-2.5 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 active:scale-95 text-white text-[11px] font-semibold flex items-center gap-1 shadow"
                    >
                      <Camera className="w-3.5 h-3.5" /> Câmera
                    </button>
                    <button
                      type="button"
                      onClick={() => acionarGaleria('DIGITAL')}
                      className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 active:scale-95 text-slate-200 text-[11px] font-semibold flex items-center gap-1"
                    >
                      <Upload className="w-3.5 h-3.5 text-amber-400" /> Arquivo
                    </button>
                  </div>
                </div>
              </div>

              {/* Inputs nativos */}
              <input
                ref={inputCameraRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => aoProcessarArquivos(e, 'CAMERA')}
              />
              <input
                ref={inputGaleriaRef}
                type="file"
                accept="image/*,application/pdf"
                multiple
                className="hidden"
                onChange={(e) => aoProcessarArquivos(e, 'GALERIA')}
              />

              {/* Lista de Arquivos */}
              {anexos.length > 0 ? (
                <div className="grid grid-cols-2 gap-2 pt-2">
                  {anexos.map((item, idx) => (
                    <div
                      key={item.id}
                      className="relative bg-slate-950 border border-slate-800 rounded-xl overflow-hidden p-2 flex flex-col justify-between group"
                    >
                      <div className="absolute top-1.5 right-1.5 flex items-center gap-1 z-10">
                        {!item.isPdf && (
                          <button
                            type="button"
                            onClick={() => abrirScannerComArquivo(item.file, item.categoria, idx)}
                            title="Ajustar no Scanner"
                            className="bg-blue-600/90 text-white p-1 rounded-md active:scale-95 transition"
                          >
                            <ScanLine className="w-3 h-3" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => removerAnexo(idx)}
                          title="Remover"
                          className="bg-red-600/90 text-white p-1 rounded-md active:scale-95 transition"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>

                      {item.isPdf ? (
                        <div className="h-20 flex flex-col items-center justify-center text-rose-400 bg-rose-950/20 rounded-lg mb-1 border border-rose-900/40 relative overflow-hidden">
                          {item.previewImgUrl && (
                            <img
                              src={item.previewImgUrl}
                              alt=""
                              className="absolute inset-0 w-full h-full object-cover opacity-25"
                            />
                          )}
                          <FileCheck2 className="w-7 h-7 mb-0.5 relative z-10" />
                          <span className="text-[9px] font-mono font-bold text-rose-300 uppercase relative z-10">
                            PDF ESCANEADO
                          </span>
                        </div>
                      ) : (
                        <div className="h-20 overflow-hidden rounded-lg mb-1 bg-black">
                          <img src={item.url} alt={item.nomeArquivo} className="w-full h-full object-cover" />
                        </div>
                      )}

                      <div className="space-y-0.5">
                        <div className="flex items-center justify-between text-[10px]">
                          <span className="font-bold text-blue-400 font-mono">{item.categoria}</span>
                          <span className="text-slate-400 text-[9px]">{item.tamanhoKb} KB</span>
                        </div>
                        <p
                          className="text-[9px] text-slate-300 font-mono truncate"
                          title={item.nomeArquivo}
                        >
                          {item.nomeArquivo}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-5 text-center text-slate-500 border border-slate-800/60 rounded-xl bg-slate-950/40">
                  <FolderOpen className="w-7 h-7 mx-auto mb-1 opacity-30" />
                  <p className="text-xs">Nenhum arquivo ou foto adicionada.</p>
                  <p className="text-[10px] text-slate-600">
                    Fotografe documentos com o Scanner integrado ou anexe arquivos.
                  </p>
                </div>
              )}
            </div>

            {/* 4. Botões de Envio e Persistência */}
            <div className="space-y-2 pt-1">
              <button
                type="button"
                disabled={enviandoDrive}
                onClick={enviarParaGoogleDrive}
                className="w-full bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 disabled:opacity-60 text-white font-bold py-3.5 px-4 rounded-2xl shadow-lg shadow-emerald-600/30 flex items-center justify-center gap-2 text-sm transition"
              >
                <CloudUpload className="w-5 h-5" />
                <span>
                  {enviandoDrive
                    ? 'Salvando e enviando ao Drive...'
                    : 'Enviar Direto para meu Google Drive'}
                </span>
              </button>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={salvandoLocal}
                  onClick={salvarAtendimentoApenasLocal}
                  className="w-full bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-500/40 font-semibold py-2.5 px-3 rounded-xl text-xs transition flex items-center justify-center gap-1.5"
                >
                  <HardDriveDownload className="w-4 h-4 text-blue-400" />
                  <span>{salvandoLocal ? 'Salvando...' : 'Salvar no Aparelho'}</span>
                </button>

                <button
                  type="button"
                  onClick={enviarCompartilhamentoNativo}
                  className="w-full bg-slate-900 hover:bg-slate-800 text-slate-300 font-semibold py-2.5 px-3 rounded-xl text-xs transition border border-slate-800 flex items-center justify-center gap-1.5"
                >
                  <Share2 className="w-4 h-4 text-slate-400" />
                  <span>Compartilhar</span>
                </button>
              </div>

              <button
                type="button"
                onClick={limparTudo}
                className="w-full text-slate-500 hover:text-red-400 font-medium py-2 text-[11px] transition flex items-center justify-center gap-1"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Limpar formulário para novo atendimento</span>
              </button>
            </div>
          </div>
        ) : (
          /* ABA 2: HISTÓRICO / PASTAS */
          <div className="space-y-3">
            {/* Barra de Ferramentas de Busca */}
            <div className="bg-slate-900 border border-slate-800 p-3.5 rounded-2xl shadow-sm space-y-2.5">
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={filtroTexto}
                  onChange={(e) => setFiltroTexto(e.target.value)}
                  placeholder="Buscar por nome, guia ou BO..."
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl pl-9 pr-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="flex items-center gap-1.5">
                <div className="relative flex-1">
                  <input
                    type="date"
                    value={filtroDataIso}
                    onChange={(e) => setFiltroDataIso(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-blue-500 font-mono"
                  />
                </div>
                <button
                  type="button"
                  onClick={filtrarHoje}
                  className="px-3 py-1.5 rounded-xl bg-blue-600/20 border border-blue-500/40 text-blue-300 hover:bg-blue-600/30 text-[11px] font-bold transition whitespace-nowrap"
                >
                  Hoje
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setFiltroTexto('');
                    setFiltroDataIso('');
                  }}
                  className="px-3 py-1.5 rounded-xl bg-slate-800 border border-slate-700 text-slate-300 hover:text-white text-[11px] font-semibold transition whitespace-nowrap"
                >
                  Ver Todos
                </button>
              </div>
            </div>

            {/* Árvore Visual de Pastas */}
            {Object.keys(gruposPorData).length > 0 ? (
              <div className="space-y-2.5">
                {Object.entries(gruposPorData).map(([dataKey, casosDia]) => {
                  const aberta = pastasDataAbertas[dataKey] !== false;
                  return (
                    <div
                      key={dataKey}
                      className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-sm"
                    >
                      <button
                        type="button"
                        onClick={() =>
                          setPastasDataAbertas((prev) => ({
                            ...prev,
                            [dataKey]: prev[dataKey] === false ? true : false,
                          }))
                        }
                        className="w-full px-3.5 py-2.5 bg-slate-900 hover:bg-slate-800/60 flex items-center justify-between text-left transition"
                      >
                        <div className="flex items-center gap-2">
                          {aberta ? (
                            <FolderOpen className="w-4 h-4 text-amber-400" />
                          ) : (
                            <Folder className="w-4 h-4 text-amber-400" />
                          )}
                          <span className="text-xs font-extrabold font-mono text-slate-200">
                            {dataKey}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-mono text-slate-400 bg-slate-950 px-2 py-0.5 rounded-full border border-slate-800">
                            {casosDia.length} caso(s)
                          </span>
                          {aberta ? (
                            <ChevronUp className="w-4 h-4 text-slate-400" />
                          ) : (
                            <ChevronDown className="w-4 h-4 text-slate-400" />
                          )}
                        </div>
                      </button>

                      {aberta && (
                        <div className="p-2.5 pt-1 space-y-2 border-t border-slate-800/60">
                          {casosDia.map((caso) => {
                            const pastaNome = `${caso.modalidade}_${caso.nomeCaso || sanitizar(caso.nome)}`;
                            return (
                              <button
                                key={caso.id}
                                type="button"
                                onClick={() => {
                                  setConfirmandoExclusao(false);
                                  setCasoDetalhe(caso);
                                }}
                                className="w-full text-left bg-slate-950 hover:bg-slate-900/90 border border-slate-800/90 rounded-xl p-2.5 flex items-center justify-between gap-2 transition active:scale-[0.99]"
                              >
                                <div className="flex items-center gap-2.5 min-w-0">
                                  <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 flex items-center justify-center flex-shrink-0">
                                    <Folder className="w-4 h-4" />
                                  </div>
                                  <div className="min-w-0">
                                    <p className="text-xs font-bold font-mono text-slate-100 truncate">
                                      {pastaNome}
                                    </p>
                                    <div className="flex items-center gap-1.5 text-[10px] text-slate-400 mt-0.5">
                                      <span
                                        className={`px-1.5 py-0.2 rounded border text-[9px] font-bold ${
                                          caso.modalidade === 'NECRO'
                                            ? 'text-red-300 bg-red-500/15 border-red-500/30'
                                            : 'text-blue-300 bg-blue-500/15 border-blue-500/30'
                                        }`}
                                      >
                                        {caso.modalidade}
                                      </span>
                                      <span>Guia: {caso.guia || 'S/N'}</span>
                                      <span>·</span>
                                      <span>{caso.arquivos.length} arq.</span>
                                    </div>
                                  </div>
                                </div>
                                <div className="flex flex-col items-end gap-1 flex-shrink-0">
                                  {caso.enviadoDrive ? (
                                    <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                                      Drive OK
                                    </span>
                                  ) : (
                                    <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30">
                                      Local
                                    </span>
                                  )}
                                  <ChevronRight className="w-3.5 h-3.5 text-slate-500" />
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="py-10 text-center text-slate-500 border border-slate-800/60 rounded-2xl bg-slate-900/40 px-4">
                <FolderSearch className="w-10 h-10 mx-auto mb-2 opacity-30 text-amber-400" />
                <p className="text-xs font-semibold text-slate-400">
                  Nenhum atendimento encontrado no arquivo local.
                </p>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Os casos salvos ou enviados aparecerão organizados por data e pasta individual.
                </p>
              </div>
            )}
          </div>
        )}
      </main>

      {/* ========================================== */}
      {/* MODAL DO SCANNER DE DOCUMENTOS (PÓS-FOTO)  */}
      {/* ========================================== */}
      {scannerAberto && (
        <div className="fixed inset-0 z-[55] bg-slate-950/95 backdrop-blur-md flex flex-col justify-between p-3 sm:p-4">
          <div className="max-w-md mx-auto w-full flex items-center justify-between border-b border-slate-800 pb-2.5">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-blue-600/20 border border-blue-500/40 text-blue-400 flex items-center justify-center">
                <ScanLine className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-xs font-extrabold uppercase tracking-wider text-white">
                  Ajuste do Scanner Pericial
                </h3>
                <p className="text-[10px] text-slate-400 font-mono">
                  Categoria: {scannerCategoria}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={fecharScannerModal}
              className="p-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-400 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-1 max-w-md mx-auto w-full my-2 relative bg-black/90 border border-slate-800 rounded-2xl overflow-hidden flex items-center justify-center min-h-[240px]">
            {scannerPreviewUrl && (
              <img
                src={scannerPreviewUrl}
                alt="Pré-visualização do Scanner"
                className="max-w-full max-h-[46vh] object-contain transition-opacity duration-150"
              />
            )}
            {scannerProcessando && (
              <div className="absolute inset-0 bg-slate-950/80 flex flex-col items-center justify-center gap-2">
                <div className="w-7 h-7 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                <span className="text-[11px] font-mono text-blue-300">
                  Processando documento...
                </span>
              </div>
            )}
          </div>

          <div className="max-w-md mx-auto w-full bg-slate-900 border border-slate-800 rounded-2xl p-3 space-y-3 shadow-2xl">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Filtro de Tratamento
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => rotacionarScanner(-90)}
                    className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-[10px] font-semibold flex items-center gap-1 active:scale-95 transition"
                  >
                    <RotateCcw className="w-3 h-3 text-blue-400" /> 90° Esq
                  </button>
                  <button
                    type="button"
                    onClick={() => rotacionarScanner(90)}
                    className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-[10px] font-semibold flex items-center gap-1 active:scale-95 transition"
                  >
                    <RotateCw className="w-3 h-3 text-blue-400" /> 90° Dir
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-1.5">
                <button
                  type="button"
                  onClick={() => alterarFiltroScanner('PB')}
                  className={`py-2 px-2 rounded-xl border text-[11px] font-bold flex flex-col items-center justify-center gap-0.5 transition ${
                    scannerFiltro === 'PB'
                      ? 'bg-blue-600/25 border-blue-500 text-blue-200 shadow-sm'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <FileSearch className="w-3.5 h-3.5" />
                  <span>P&B Documento</span>
                </button>
                <button
                  type="button"
                  onClick={() => alterarFiltroScanner('COR')}
                  className={`py-2 px-2 rounded-xl border text-[11px] font-bold flex flex-col items-center justify-center gap-0.5 transition ${
                    scannerFiltro === 'COR'
                      ? 'bg-blue-600/25 border-blue-500 text-blue-200 shadow-sm'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Cor Aprimorada</span>
                </button>
                <button
                  type="button"
                  onClick={() => alterarFiltroScanner('ORIGINAL')}
                  className={`py-2 px-2 rounded-xl border text-[11px] font-bold flex flex-col items-center justify-center gap-0.5 transition ${
                    scannerFiltro === 'ORIGINAL'
                      ? 'bg-blue-600/25 border-blue-500 text-blue-200 shadow-sm'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <ImageIcon className="w-3.5 h-3.5" />
                  <span>Foto Original</span>
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                Formato de Saída
              </span>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setScannerFormato('PDF')}
                  className={`py-2 px-3 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition ${
                    scannerFormato === 'PDF'
                      ? 'bg-emerald-600/20 border-emerald-500 text-emerald-300'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <FileCheck2 className="w-4 h-4" />
                  <span>Gerar PDF (A4)</span>
                </button>
                <button
                  type="button"
                  onClick={() => setScannerFormato('JPG')}
                  className={`py-2 px-3 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition ${
                    scannerFormato === 'JPG'
                      ? 'bg-emerald-600/20 border-emerald-500 text-emerald-300'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <FileImage className="w-4 h-4" />
                  <span>Salvar JPEG HD</span>
                </button>
              </div>
            </div>

            <button
              type="button"
              disabled={scannerExportando || scannerProcessando}
              onClick={confirmarEscaneamento}
              className="w-full bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 disabled:opacity-60 text-white font-bold py-3 px-4 rounded-xl shadow-lg shadow-emerald-600/25 flex items-center justify-center gap-2 text-xs transition"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>
                {scannerExportando ? 'Gerando arquivo final...' : 'Confirmar Escaneamento'}
              </span>
            </button>
          </div>
        </div>
      )}

      {/* Gaveta / Modal de Detalhes do Atendimento */}
      {casoDetalhe && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-slate-900 border-t sm:border border-slate-800 max-w-md w-full rounded-t-3xl sm:rounded-2xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
            <div className="p-4 border-b border-slate-800 flex items-start justify-between gap-2 bg-slate-900/95">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 mb-1">
                  <span
                    className={`text-[10px] font-extrabold px-2 py-0.5 rounded-md uppercase border ${
                      casoDetalhe.modalidade === 'NECRO'
                        ? 'bg-red-500/20 text-red-300 border-red-500/40'
                        : 'bg-blue-500/20 text-blue-300 border-blue-500/40'
                    }`}
                  >
                    {casoDetalhe.modalidade}
                  </span>
                  <span
                    className={`text-[10px] font-mono px-2 py-0.5 rounded-md border ${
                      casoDetalhe.enviadoDrive
                        ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                        : 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                    }`}
                  >
                    {casoDetalhe.enviadoDrive ? 'Sincronizado Drive' : 'Salvo no Aparelho'}
                  </span>
                </div>
                <h3 className="text-xs font-extrabold text-white font-mono truncate">
                  {`${casoDetalhe.modalidade}_${casoDetalhe.nomeCaso || sanitizar(casoDetalhe.nome)}`}
                </h3>
                <p className="text-[11px] text-slate-400">
                  Data: {casoDetalhe.data}
                  {casoDetalhe.hora ? ` às ${casoDetalhe.hora}` : ''} · Periciando: {casoDetalhe.nome}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCasoDetalhe(null)}
                className="p-1.5 rounded-lg bg-slate-800 text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 overflow-y-auto space-y-3 flex-1">
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 space-y-1.5 text-xs">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <span className="text-[10px] text-slate-500 uppercase font-bold block">
                      Guia / Ofício
                    </span>
                    <span className="font-mono text-slate-200">{casoDetalhe.guia || 'S/N'}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 uppercase font-bold block">
                      Boletim (BO)
                    </span>
                    <span className="font-mono text-slate-200">{casoDetalhe.bo || 'S/N'}</span>
                  </div>
                </div>
                <div className="pt-1 border-t border-slate-900">
                  <span className="text-[10px] text-slate-500 uppercase font-bold block">
                    Observações
                  </span>
                  <span className="text-slate-300 text-[11px]">
                    {casoDetalhe.obs || 'Sem observações'}
                  </span>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    Vestígios e Documentos Coletados
                  </span>
                  <span className="text-[10px] font-mono text-slate-400">
                    {casoDetalhe.arquivos.length} ficheiro(s)
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {casoDetalhe.arquivos.map((arq, idx) => {
                    const isPdf =
                      arq.mimeType === 'application/pdf' ||
                      arq.nome.toLowerCase().endsWith('.pdf');
                    const dataUri = `data:${arq.mimeType || (isPdf ? 'application/pdf' : 'image/jpeg')};base64,${arq.base64}`;
                    return (
                      <div
                        key={idx}
                        onClick={() => abrirArquivoPersistido(arq)}
                        className="cursor-pointer bg-slate-950 hover:bg-slate-900 border border-slate-800 rounded-xl p-2 flex flex-col justify-between transition active:scale-95"
                      >
                        {isPdf ? (
                          <div className="h-24 flex flex-col items-center justify-center text-rose-400 bg-rose-950/20 rounded-lg mb-1.5 border border-rose-900/40">
                            <FileText className="w-8 h-8 mb-1" />
                            <span className="text-[9px] font-mono font-bold text-rose-300 uppercase">
                              ABRIR PDF
                            </span>
                          </div>
                        ) : (
                          <div className="h-24 overflow-hidden rounded-lg mb-1.5 bg-black">
                            <img
                              src={dataUri}
                              alt={arq.nome}
                              className="w-full h-full object-cover"
                            />
                          </div>
                        )}
                        <div>
                          <div className="flex items-center justify-between text-[9px] mb-0.5">
                            <span className="font-bold text-blue-400 font-mono">
                              {arq.categoria || 'ARQUIVO'}
                            </span>
                            <span className="text-slate-500">
                              {arq.tamanhoKb ? `${arq.tamanhoKb} KB` : ''}
                            </span>
                          </div>
                          <p
                            className="text-[9px] text-slate-300 font-mono truncate"
                            title={arq.nome}
                          >
                            {arq.nome}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="p-3.5 border-t border-slate-800 bg-slate-950/90 space-y-2">
              <button
                type="button"
                disabled={reenviandoCaso}
                onClick={reenviarCasoParaDrive}
                className="w-full bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 disabled:opacity-60 text-white font-bold py-2.5 px-4 rounded-xl text-xs flex items-center justify-center gap-1.5 shadow-md transition"
              >
                <CloudUpload className="w-4 h-4" />
                <span>
                  {reenviandoCaso
                    ? 'Reenviando para o Google Drive...'
                    : 'Reenviar para Google Drive'}
                </span>
              </button>

              {confirmandoExclusao ? (
                <div className="flex items-center gap-2 bg-rose-950/40 border border-rose-800/60 p-2 rounded-xl">
                  <span className="text-[11px] text-rose-200 flex-1">
                    Confirmar exclusão permanente?
                  </span>
                  <button
                    type="button"
                    onClick={confirmarExclusaoRegistro}
                    className="px-2.5 py-1 rounded-lg bg-rose-600 text-white text-[11px] font-bold"
                  >
                    Excluir
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmandoExclusao(false)}
                    className="px-2.5 py-1 rounded-lg bg-slate-800 text-slate-300 text-[11px]"
                  >
                    Cancelar
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={exportarTodosArquivosCaso}
                    className="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-semibold py-2 px-3 rounded-xl text-[11px] flex items-center justify-center gap-1.5 transition"
                  >
                    <Download className="w-3.5 h-3.5 text-blue-400" />
                    <span>Exportar / Baixar Todos</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmandoExclusao(true)}
                    className="bg-rose-950/40 hover:bg-rose-900/50 text-rose-300 border border-rose-800/50 font-semibold py-2 px-3 rounded-xl text-[11px] flex items-center justify-center gap-1.5 transition"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-rose-400" />
                    <span>Excluir Registro</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Lightbox de Foto em Alta Resolução */}
      {lightboxArquivo && (
        <div className="fixed inset-0 z-[60] bg-black/95 flex flex-col justify-between p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-mono text-slate-300 truncate">{lightboxArquivo.nome}</p>
            <div className="flex items-center gap-2">
              <a
                href={lightboxArquivo.dataUri}
                download={lightboxArquivo.nome}
                className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-200 text-xs font-semibold flex items-center gap-1"
              >
                <Download className="w-3.5 h-3.5" /> Baixar
              </a>
              <button
                type="button"
                onClick={() => setLightboxArquivo(null)}
                className="p-2 rounded-lg bg-slate-800 text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
          <div className="flex-1 flex items-center justify-center overflow-auto my-2">
            <img
              src={lightboxArquivo.dataUri}
              alt={lightboxArquivo.nome}
              className="max-w-full max-h-[82vh] object-contain rounded-lg"
            />
          </div>
          <p className="text-center text-[10px] text-slate-500">
            Toque em Baixar para guardar o arquivo bruto original.
          </p>
        </div>
      )}

      {/* Modal de Configuração */}
      {modalConfigOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 max-w-sm w-full rounded-2xl p-4 shadow-2xl space-y-3">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-white flex items-center gap-2">
                <Settings className="w-4 h-4 text-blue-400" /> Integração Google Drive
              </h3>
              <button
                type="button"
                onClick={() => setModalConfigOpen(false)}
                className="text-slate-400 hover:text-white p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div>
              <p className="text-[11px] text-slate-400 mb-1">
                URL do seu Google Apps Script (Web App):
              </p>
              <input
                type="url"
                value={driveUrl}
                onChange={(e) => setDriveUrl(e.target.value)}
                placeholder="https://script.google.com/macros/s/.../exec"
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500 font-mono"
              />
              <p className="text-[10px] text-slate-500 mt-1">
                Estrutura no Drive: AFIS_CAMPO / DD-MM-AAAA / [MODALIDADE]_[NOME].
              </p>
            </div>
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={salvarConfig}
                className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-2 rounded-xl text-xs"
              >
                Salvar Integração
              </button>
              <button
                type="button"
                onClick={() => setModalConfigOpen(false)}
                className="bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold py-2 px-3 rounded-xl text-xs"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
