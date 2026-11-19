// What a file of an Agent's Library gets in the read-only preview (#195): a picture, text, a table or none of them, and
// a CSV cut into its first rows.
export type PreviewKind='image'|'text'|'table'|'none';
export function filePreviewKind(name:string,type:string):PreviewKind;
export function csvRows(text:string,most?:number):string[][];
// The raster type a file's own name carries where no Engine type came with the row, or '' for anything else (#194).
export function pictureType(name:string):string;
