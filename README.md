# Coop — Cartes membres avec QR code

Objectif : imprimer des cartes papier avec QR code, rattacher chaque carte à un email / téléphone, distinguer deux statuts (adhérent / sociétaire), relier le tout à un Google Sheet synchronisé avec Open Collective, et pouvoir scanner une carte au comptoir pour voir les contributions mensuelles.

Choix : tout tient dans un Google Sheet + un Google Apps Script. Pas de serveur, pas d'hébergement, coût 0 €.

---

## 1. Le Google Sheet, source de vérité

Un seul fichier, trois onglets.

- **Membres** : `id` (UUID aléatoire, jamais un numéro séquentiel), `nom`, `email`, `téléphone`, `statut` (`adhérent` ou `sociétaire`), `date_carte`, optionnellement `oc_slug`.
- **Contributions** : rempli automatiquement depuis Open Collective. Colonnes `date`, `email`, `montant`, `devise`, `palier`, `fréquence`.
- **Config** : slug du collectif, nombre de mois affichés, etc.

Le statut vit dans la feuille, pas dans le QR code. Changer un statut = changer une cellule, pas besoin de réimprimer.

## 2. Synchro Open Collective → Sheet

Open Collective expose une API GraphQL : `https://api.opencollective.com/graphql/v2`.
Un Apps Script avec un déclencheur quotidien va chercher les transactions récentes et les écrit dans l'onglet Contributions.

```graphql
query ($slug: String!, $dateFrom: DateTime) {
  account(slug: $slug) {
    transactions(type: CREDIT, kind: CONTRIBUTION, dateFrom: $dateFrom, limit: 500) {
      nodes {
        createdAt
        amount { value currency }
        fromAccount { name slug ... on Individual { email } }
        order { frequency tier { name } }
      }
    }
  }
}
```

- Token personnel Open Collective : réglages du compte, section développeurs.
- Stocker le token dans `PropertiesService.getScriptProperties()`, jamais dans la feuille ni dans le code.
- Rapprochement membre ↔ contribution par email.
- **À vérifier** : l'email du contributeur n'est renvoyé que si le token appartient à un admin du collectif. Tester dans l'explorateur GraphQL avant de construire dessus. Secours : colonne `oc_slug` dans Membres.
- Bonus : si les paliers Open Collective correspondent à adhérent / sociétaire, le script peut préremplir le statut.

## 3. QR code et page de scan

Le QR encode une URL vers le même Apps Script déployé en application web :

```
https://script.google.com/macros/s/XXXX/exec?id=<uuid-du-membre>
```

Deux routes :
- sans paramètre → page de scan pour le comptoir (lecteur USB) ;
- avec `?id=` → fiche du membre (cas du scan au téléphone).

```javascript
function doGet(e) {
  if (!e.parameter.id) {
    return HtmlService.createHtmlOutputFromFile('scan');
  }
  const member = findMember(e.parameter.id);
  if (!member) return HtmlService.createHtmlOutput('Carte inconnue');
  const contribs = contributionsFor(member.email, 6);
  const tpl = HtmlService.createTemplateFromFile('card');
  tpl.member = member;
  tpl.contribs = contribs;
  return tpl.evaluate();
}

function lookup(id) {
  const member = findMember(id);
  if (!member) throw new Error('Carte inconnue');
  const contribs = contributionsFor(member.email, 6);
  return {
    prenom: member.prenom,
    statut: member.statut,
    aJourCeMois: contribs.some(c => c.mois === moisCourant()),
    contribs,
  };
}
```

Déploiement : « exécuter en tant que moi », accès « tout le monde ayant le lien ».
La sécurité repose sur l'UUID impossible à deviner et sur la sobriété de la page : afficher statut et état du mois, jamais l'email ni le téléphone.

## 4. Page comptoir avec lecteur USB

Le lecteur USB se comporte comme un clavier : il tape le contenu du QR code puis envoie Entrée. La page garde un champ texte avec le focus, extrait l'id et affiche le résultat sans rechargement.

```html
<input id="scan" autofocus autocomplete="off" placeholder="Scannez une carte…">
<div id="result"></div>

<script>
  const input = document.getElementById('scan');
  const result = document.getElementById('result');

  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const raw = input.value.trim();
    const id = (raw.match(/id=([0-9a-f-]{36})/i) || [, raw])[1];
    input.value = '';
    result.textContent = 'Recherche…';
    google.script.run
      .withSuccessHandler(render)
      .withFailureHandler(() => result.textContent = 'Carte inconnue')
      .lookup(id);
  });

  // Le focus ne doit jamais quitter le champ.
  document.addEventListener('click', () => input.focus());
  input.addEventListener('blur', () => setTimeout(() => input.focus(), 0));

  function render(m) {
    result.innerHTML = `
      <h1 class="${m.statut}">${m.prenom} · ${m.statut.toUpperCase()}</h1>
      <p class="${m.aJourCeMois ? 'ok' : 'ko'}">
        ${m.aJourCeMois ? 'À jour ce mois-ci' : 'Pas de contribution ce mois-ci'}
      </p>
      <ul>${m.contribs.map(c => `<li>${c.mois} — ${c.montant} €</li>`).join('')}</ul>`;
  }
</script>
```

### L'« app » = un raccourci Chrome

Sur l'URL de l'Apps Script, dans Chrome ou Edge : menu ⋮ → « Caster, enregistrer et partager » → « Installer la page en tant qu'application » (ou « Créer un raccourci » avec « Ouvrir dans une fenêtre »).
Résultat : une icône dans le Dock / la barre des tâches, une fenêtre sans barre d'adresse, lançable au démarrage. Ce n'est pas une vraie PWA (Apps Script ne sert pas de manifeste), mais pour un poste de comptoir ça ne change rien.

### Pièges du lecteur USB

- **Disposition clavier AZERTY** : le lecteur émule un clavier QWERTY par défaut, donc chiffres et `:` `/` ressortent faux. Scanner le code-barres « French keyboard » de la notice du lecteur, puis tester dans un éditeur de texte : l'URL doit apparaître exactement.
- **Suffixe Entrée** : la plupart des lecteurs l'envoient par défaut, sinon code-barres de configuration dans la notice.
- **Matériel** : lecteur 2D filaire (les 1D ne lisent pas les QR), 25 à 40 €. Un modèle sur socle mains libres est pratique au comptoir.

## 5. Impression des cartes

Page HTML statique avec `qrcode.js`, qui lit un export CSV de l'onglet Membres et génère une grille de cartes au format 85,6 × 54 mm (`@page`, `page-break-inside: avoid`). Couleur ou bandeau différent selon le statut. Impression navigateur → PDF → imprimeur ou papier épais.

Prévisualisation rapide dans le Sheet, sans code :

```
=IMAGE("https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=" & ENCODEURL(url))
```

## 6. Fonctionnement au quotidien

1. Nouveau membre : ajouter une ligne dans Membres, menu Apps Script « Générer l'id » remplit l'UUID.
2. Réimprimer la page de cartes filtrée sur les nouveaux.
3. Chaque jour, le script rapatrie les contributions Open Collective.
4. Au comptoir : scan au lecteur USB ou au téléphone, la fiche s'affiche en une seconde.

## 7. Points de vigilance

- **RGPD** : emails et téléphones dans une feuille Google. Partage restreint, jamais affichés sur la page scannée.
- **Doublon d'email** : si un membre paie avec un autre email que celui de la feuille, le rapprochement échoue. Colonne `oc_slug` en secours.
- **Quotas Apps Script** : largement suffisants pour une petite boutique.
- **Alternative** : AppSheet (no-code Google) se branche sur le Sheet avec un bouton « scanner » natif. Utile seulement si plusieurs personnes tiennent le comptoir et préfèrent une vraie appli.

## Prochaine étape

Écrire le script Apps Script complet : `doGet` avec les deux routes, `lookup`, la synchro Open Collective, le gabarit HTML de la page de scan et celui de la fiche membre.

---

# Prototype : app de scan (GitHub Pages)

Première brique, sans Apps Script : une page web statique dans [`docs/`](docs/), servie par GitHub Pages, installable sur un téléphone comme une app.

- **URL** : https://clarabesset.github.io/Coop/
- **Source unique** : l'onglet **Transactions** du Google Sheet, qui contient l'export CSV des transactions Open Collective. Aucun autre onglet n'est lu.
- **Identifiant d'une carte** : le pseudo Open Collective du contributeur, colonne « Opposite Account Handle » (ex. `max73`). C'est ce que le QR code encode, sous la forme `https://clarabesset.github.io/Coop/?id=max73`.
- **Ce qu'affiche l'app après un scan** : le nom du contributeur, son palier (texte entre parenthèses de la description, ex. « Cotisation mensuelle »), « À jour ce mois-ci » ou « Pas de contribution ce mois-ci », la date et le montant de la dernière contribution, et le montant net des 6 derniers mois.
- **Route `?id=<pseudo>`** : affiche directement la fiche, pour un QR scanné avec l'app caméra native du téléphone.
- **Cartes de test** : https://clarabesset.github.io/Coop/cartes.html génère un QR par contributeur pour tester le scan depuis un écran.

## Règles de calcul

- Seules les lignes `Kind = CONTRIBUTION` comptent.
- Les remboursements (`Credit/Debit = DEBIT`, montant négatif) se soustraient du mois où ils tombent. Un mois est « payé » si son montant net est positif.
- Si la colonne « Is Reversed » existe et est remplie, la ligne est ignorée.
- Nom et palier d'un contributeur viennent de sa contribution créditée la plus récente.

## Rendre le Sheet lisible par l'app

L'app lit l'onglet via l'export CSV public, sans clé ni serveur. Il faut donc :

1. Ouvrir le Sheet → **Partager** → « Accès général » → **Tous les utilisateurs disposant du lien** → rôle **Lecteur**.
2. Un onglet nommé exactement `Transactions`, avec au minimum les colonnes `Effective Date & Time`, `Amount Single Column`, `Opposite Account Handle`, `Opposite Account Name`, `Credit/Debit`, `Kind`, `Description`. L'export CSV d'Open Collective importé tel quel convient.
3. L'identifiant du Sheet et le nom de l'onglet sont dans [`docs/data.js`](docs/data.js).

Pour mettre à jour les données : réexporter les transactions depuis Open Collective et réimporter le CSV dans l'onglet (Fichier → Importer → Remplacer la feuille active). La synchro automatique par Apps Script décrite plus haut remplacera cette étape manuelle.

Point RGPD : avec le mode « lien public », toute personne connaissant l'URL du Sheet peut lire la liste des contributeurs et leurs montants. Les noms sont les pseudos publics Open Collective, il n'y a ni email ni téléphone. La version Apps Script décrite plus haut remplace ce partage public par un script qui lit la feuille à la place de l'utilisateur.

## Installer sur le téléphone

- **iPhone (Safari)** : ouvrir l'URL → bouton Partager → « Sur l'écran d'accueil ».
- **Android (Chrome)** : ouvrir l'URL → menu ⋮ → « Installer l'application » ou « Ajouter à l'écran d'accueil ».

La caméra exige HTTPS, ce que GitHub Pages fournit. Sur iPhone, la caméra démarre sur un bouton, Safari refusant son ouverture automatique.

## Développer en local

```
cd docs && python3 -m http.server 8080
```

Sur `http://localhost`, la caméra fonctionne sans HTTPS. Pour tester depuis le téléphone, passer par l'URL GitHub Pages de la branche fusionnée.
