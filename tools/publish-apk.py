"""Publish a checked, already signed APK; never build or replace a release."""
import argparse
import glob
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import urllib.error
import urllib.parse
import urllib.request


def check(root):
    config = json.loads((root / 'tools/release-apk.json').read_text())
    gradle = (root / 'app/build.gradle').read_text()
    version = re.search(r"versionName\s+['\"]([0-9]+\.[0-9]+\.[0-9]+)['\"]", gradle).group(1)
    code = int(re.search(r'versionCode\s+(\d+)', gradle).group(1))
    apk = root / 'docs/downloads' / (config['prefix'] + '-' + version + '.apk')
    assert apk.is_file() and 0 < apk.stat().st_size <= 200 * 1024 * 1024, 'APK versionné absent ou trop volumineux'
    digest = hashlib.sha256(apk.read_bytes()).hexdigest()
    checksum = apk.with_suffix('.apk.sha256')
    assert checksum.read_text().split()[0] == digest, 'Empreinte APK incorrecte'
    sdk = os.environ.get('ANDROID_HOME') or os.environ.get('ANDROID_SDK_ROOT', '')
    candidates = glob.glob(str(Path(sdk) / 'build-tools/*'))
    build_tools = os.environ.get('CERCLE_BUILD_TOOLS') or sorted(candidates, key=lambda p: [int(x) if x.isdigit() else 0 for x in Path(p).name.split('.')])[-1]
    java = str(Path(os.environ['JAVA_HOME']) / 'bin' / ('java.exe' if os.name == 'nt' else 'java')) if os.environ.get('JAVA_HOME') else shutil.which('java')
    cert = subprocess.check_output([java, '-jar', str(Path(build_tools) / 'lib/apksigner.jar'), 'verify', '--verbose', '--print-certs', str(apk)], text=True)
    signers = sorted(re.findall(r'certificate SHA-256 digest: ([0-9a-f]{64})', cert))
    assert signers == sorted(config['signers']), 'La clé de signature a changé'
    aapt = str(Path(build_tools) / ('aapt2.exe' if os.name == 'nt' else 'aapt2'))
    badging = subprocess.check_output([aapt, 'dump', 'badging', str(apk)], text=True)
    pkg = re.search(r"package: name='([^']+)' versionCode='(\d+)' versionName='([^']*)'", badging)
    assert pkg and (pkg[1], int(pkg[2]), pkg[3]) == (config['packageName'], code, version), 'Identité/version APK incohérente'
    assert 'uses-split:' not in badging, 'APK fractionné refusé'
    return config, apk, checksum, version, code, digest


def publish(root):
    config, apk, checksum, version, code, digest = check(root)
    repository = os.environ['GITHUB_REPOSITORY']
    assert repository == 'Zachiran42/' + config['prefix'], 'Dépôt inattendu'
    token = os.environ['GH_TOKEN']
    commit = os.environ['GITHUB_SHA']
    assert re.fullmatch('[a-f0-9]{40}', commit)

    def request(path, data=None, method='GET', upload=False):
        host = 'https://uploads.github.com' if upload else 'https://api.github.com'
        raw = data if isinstance(data, bytes) else json.dumps(data).encode() if data is not None else None
        headers = {'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json', 'User-Agent': 'Cercle-APK-publication', 'Content-Type': 'application/octet-stream' if upload else 'application/json'}
        try:
            with urllib.request.urlopen(urllib.request.Request(host + path, raw, headers, method=method), timeout=60) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            if error.code == 404 and method == 'GET':
                return None
            raise RuntimeError('GitHub HTTP ' + str(error.code) + ' pour ' + method + ' ' + path) from None

    route = '/repos/' + repository + '/releases'
    tag = 'v' + version
    latest = request(route + '/latest')
    if latest and latest['tag_name'] != tag:
        prior_code = re.search(r'android-version-code: (\d+)', latest.get('body') or '')
        if prior_code:
            assert code > int(prior_code[1]), 'Augmentez le versionCode avant publication'
    files = [apk, checksum, root / 'LICENSE']
    expected = {p.name: 'sha256:' + hashlib.sha256(p.read_bytes()).hexdigest() for p in files}
    release = request(route + '/tags/' + tag)
    if release:
        existing = {a['name']: a.get('digest') for a in release['assets']}
        assert all(existing.get(name) == value for name, value in expected.items()), 'Version existante différente ou incomplète : ne pas remplacer un APK publié'
        assert not release['draft'] and not release['prerelease']
        print(json.dumps({'unchanged': True, 'tag': tag}))
        return
    notes = (root / 'CHANGELOG.md').read_text() if (root / 'CHANGELOG.md').exists() else ''
    body = '\n\n'.join([config['name'] + ' ' + version + ' — version de test signée.', notes, 'Android 7.0+, hors ligne, sans compte ni publicité. APK original contrôlé : paquet, version, SHA-256 et certificat. Licence MIT jointe. Aucun audit exhaustif ni essai sur téléphone effectué par cette publication.', 'Source : https://github.com/' + repository + '/tree/' + commit, 'SHA-256 : ' + digest, '<!-- android-version-code: ' + str(code) + ' -->'])
    release = request(route, {'tag_name': tag, 'target_commitish': commit, 'name': config['name'] + ' ' + version, 'body': body, 'draft': True, 'prerelease': False}, 'POST')
    for file in files:
        asset = request(route + '/' + str(release['id']) + '/assets?name=' + urllib.parse.quote(file.name), file.read_bytes(), 'POST', upload=True)
        assert asset['digest'] == expected[file.name], 'Empreinte après envoi incorrecte'
    final = request(route + '/' + str(release['id']), {'draft': False, 'make_latest': 'true'}, 'PATCH')
    assert not final['draft']
    print(json.dumps({'published': True, 'tag': tag, 'url': final['html_url'], 'versionCode': code, 'sha256': digest}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    if args.check:
        _, _, _, version, code, digest = check(root)
        print(json.dumps({'valid': True, 'version': version, 'versionCode': code, 'sha256': digest}))
    else:
        publish(root)
