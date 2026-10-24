'use strict';
// The nonce authorizes only our versioned same-origin public decoder asset.
const qrDecoderNonce=document.currentScript?.nonce;
let qrDecoderLoad=null;
function loadQrDecoder(){
 if(window.ZXing?.BrowserQRCodeReader)return Promise.resolve(window.ZXing);
 if(qrDecoderLoad)return qrDecoderLoad;
 qrDecoderLoad=new Promise((resolve,reject)=>{
  const script=document.createElement('script');script.nonce=qrDecoderNonce??'';script.src='__QR_DECODER_URL__';script.async=true;
  const timer=setTimeout(()=>failed(),15000);
  function failed(){clearTimeout(timer);script.onload=script.onerror=null;script.remove();qrDecoderLoad=null;reject(new Error('QR decoder unavailable. Retry or search by pass ID.'));}
  script.onerror=failed;script.onload=()=>{clearTimeout(timer);if(!window.ZXing?.BrowserQRCodeReader){failed();return;}resolve(window.ZXing);};document.head.append(script);
 });
 return qrDecoderLoad;
}
