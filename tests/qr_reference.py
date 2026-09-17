"""Independent exact matrix comparison; not OCR and not a live payment test.
Requires Python qrcode: pip install qrcode
"""
from pathlib import Path
import json, subprocess
import qrcode
from qrcode.util import QRData, MODE_8BIT_BYTE
ROOT=Path(__file__).resolve().parents[1]
texts=['Pact wallet transfer','USDC / café / Việt Nam']+['x'*n for n in [1,16,25,50,75,100,150,200,250,300,400,500,600,700,800]]
texts += ['solana:7NKaBcExample?amount=25&spl-token=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&message=Wallet%20transfer%20only']
code="import {qrMatrix} from './public/qr.mjs';let s='';for await(const c of process.stdin)s+=c;console.log(JSON.stringify(JSON.parse(s).map(qrMatrix)));"
ours=json.loads(subprocess.check_output(['node','--input-type=module','-e',code],input=json.dumps(texts).encode(),cwd=ROOT))
for text, matrix in zip(texts,ours):
    qr=qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_L,border=0,mask_pattern=0)
    qr.add_data(QRData(text.encode(),mode=MODE_8BIT_BYTE),optimize=0);qr.make(fit=True)
    assert matrix==qr.get_matrix(),f'Matrix mismatch: {len(text.encode())} bytes'
print(f'{len(texts)} QR matrices match python-qrcode exactly, including Unicode and payment-URI samples.')
