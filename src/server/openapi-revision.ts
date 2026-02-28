let revision = 1;

export const bumpOpenApiRevision = () => {
  revision += 1;
  return revision;
};

export const getOpenApiRevision = () => revision;
