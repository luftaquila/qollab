/** typst-ts 0.8's dummy filesystem builds constant callbacks with Function().
 * Replace only those generated bindings with static functions, so PDF workers
 * work with wasm-unsafe-eval without permitting JavaScript unsafe-eval.
 * Unknown callbacks fail closed; document text is never evaluated as JS.
 */
export function typstCsp() {
  return {
    name: "qollab-typst-csp",
    enforce: "pre" as const,
    transform(source: string, id: string) {
      if (!id.endsWith("/typst_ts_web_compiler.mjs")) return;
      const count = (source.match(/new Function\(/g) || []).length;
      if (count !== 2)
        throw new Error("Typst bindings changed: review the CSP adapter");
      return (
        `function qollabStaticFunction(...args) {
        const body=args.at(-1).trim().replace(/;$/, '');
        if(args.length===1) {
          if(body==='return 0')return ()=>0;
          if(body==='return true')return ()=>true;
          if(body==='return false')return ()=>false;
          if(body==='return null')return ()=>null;
          if(body==='return undefined'||body==='')return ()=>undefined;
          if(body==='return new Uint8Array()')return ()=>new Uint8Array();
          if(body==="throw new Error('Dummy AccessModel, please initialize compiler with withAccessModel()')")return ()=>{throw new Error('Missing file in PDF snapshot')};
          if(body==="throw new Error('Dummy Registry, please initialize compiler with withPackageRegistry()')")return ()=>{throw new Error('External Typst packages are not included in this PDF snapshot')};
        }
        if(args.length===2&&args[0]==='path'&&body==='return path')return path=>path;
        throw new Error('Unsupported Typst runtime callback: '+JSON.stringify(args));
      }\n` + source.replaceAll("new Function(", "qollabStaticFunction(")
      );
    },
  };
}
