import { createCanvas } from "@napi-rs/canvas";
export function libraryImage() {
  const canvas=createCanvas(800,300), ctx=canvas.getContext("2d");
  ctx.fillStyle="#ffffff";ctx.fillRect(0,0,800,300);ctx.fillStyle="#243b53";ctx.font="30px sans-serif";
  ctx.fillText("LIBRARY VISION CHECK",35,65);ctx.fillText("Event -> State -> View",35,140);ctx.fillText("Keep the original. Summarize the source.",35,220);
  return { png:canvas.toBuffer("image/png"),jpeg:canvas.toBuffer("image/jpeg") };
}
export function scannedPDF(jpeg:Buffer) {
  const stream=Buffer.from("q 800 0 0 300 0 0 cm /Im0 Do Q"),objects=[
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"),Buffer.from("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
    Buffer.from("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 800 300] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>"),
    Buffer.concat([Buffer.from(`<< /Length ${stream.length} >>\nstream\n`),stream,Buffer.from("\nendstream")]),
    Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width 800 /Height 300 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`),jpeg,Buffer.from("\nendstream")]),
  ];
  const parts=[Buffer.from("%PDF-1.4\n")],offsets:number[]=[];let offset=parts[0].length;
  objects.forEach((object,i)=>{offsets.push(offset);const p=Buffer.concat([Buffer.from(`${i+1} 0 obj\n`),object,Buffer.from("\nendobj\n")]);parts.push(p);offset+=p.length;});
  parts.push(Buffer.from(`xref\n0 6\n0000000000 65535 f \n${offsets.map(n=>`${String(n).padStart(10,"0")} 00000 n \n`).join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${offset}\n%%EOF`));return Buffer.concat(parts);
}
