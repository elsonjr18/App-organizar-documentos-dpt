/**
 * AFIS Mobile · Campo (DPT/BA) - Backend Serverless (Google Apps Script)
 *
 * Arquitetura de Armazenamento no Google Drive (2 níveis abaixo da raiz):
 * - Raiz: AFIS_CAMPO
 *   └── Nível 1 (Data do Atendimento): DD-MM-AAAA (Ex: 30-10-2026)
 *       └── Nível 2 (Pasta Individual do Periciando): [MODALIDADE]_[NOME] (Ex: CONFRONTO_FULANO_DE_TAL ou NECRO_SICRANO_DE_TAL)
 *           ├── [MODALIDADE]_[NOME]_[CATEGORIA]_[DATA]_[HORA].[ext]
 *           └── DADOS_DO_ATENDIMENTO.txt
 */

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return ContentService.createTextOutput(JSON.stringify({ status: "erro", mensagem: "Sem dados recebidos" }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    var data = JSON.parse(e.postData.contents);
    var nomeCaso = data.nomeCaso || "SEM_NOME";
    var modalidade = data.modalidade || "CONFRONTO";
    var arquivos = data.arquivos || [];
    var metadados = data.metadados || "";

    // Raiz: AFIS_CAMPO
    var rootFolders = DriveApp.getFoldersByName("AFIS_CAMPO");
    var rootFolder = rootFolders.hasNext() ? rootFolders.next() : DriveApp.createFolder("AFIS_CAMPO");

    // Nível 1: Pasta da data do atendimento no formato "DD-MM-AAAA"
    var agora = new Date();
    var dia = ("0" + agora.getDate()).slice(-2);
    var mes = ("0" + (agora.getMonth() + 1)).slice(-2);
    var ano = agora.getFullYear().toString();
    var dataAtendimento = dia + "-" + mes + "-" + ano;

    var pastaData = getOrCreateFolder(rootFolder, dataAtendimento);

    // Nível 2: Pasta individual do periciando (Ex: CONFRONTO_FULANO_DE_TAL ou NECRO_SICRANO_DE_TAL)
    var pastaCasoNome = modalidade + "_" + nomeCaso;
    var pastaCaso = getOrCreateFolder(pastaData, pastaCasoNome);

    for (var i = 0; i < arquivos.length; i++) {
      var item = arquivos[i];
      var bytes = Utilities.base64Decode(item.base64);
      var blob = Utilities.newBlob(bytes, item.mimeType || "image/jpeg", item.nome);
      pastaCaso.createFile(blob);
    }

    if (metadados) {
      pastaCaso.createFile("DADOS_DO_ATENDIMENTO.txt", metadados, MimeType.PLAIN_TEXT);
    }

    return ContentService.createTextOutput(JSON.stringify({ status: "sucesso", urlPasta: pastaCaso.getUrl() }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (erro) {
    return ContentService.createTextOutput(JSON.stringify({ status: "erro", mensagem: erro.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function getOrCreateFolder(parentFolder, folderName) {
  var folders = parentFolder.getFoldersByName(folderName);
  if (folders.hasNext()) {
    return folders.next();
  }
  return parentFolder.createFolder(folderName);
}
