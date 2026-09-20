export const crops = {
  tomato: {name:'Tomato', scientific:'Solanum lycopersicum', classes:[
    ['tomato_healthy','Healthy'],['tomato_early','Early blight'],['tomato_septoria','Septoria leaf spot']],
    datasetNote:'Leaf-group metadata is available for the selected subset.'},
  potato: {name:'Potato', scientific:'Solanum tuberosum', classes:[
    ['potato_healthy','Healthy'],['potato_early','Early blight'],['potato_late','Late blight']],
    datasetNote:'Leaf-group metadata is available. The healthy class is comparatively small.'},
  maize: {name:'Maize (corn)', scientific:'Zea mays', classes:[
    ['maize_healthy','Healthy'],['maize_rust','Common rust'],['maize_northern_blight','Northern leaf blight']],
    datasetNote:'Publisher leaf IDs are unavailable. Image-level splits are provisional; same-leaf leakage has not been ruled out.'}
};
