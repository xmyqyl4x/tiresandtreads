import { readFileSync } from 'node:fs';
export const fonts = {
  regular: readFileSync('packages/integrations/assets/report-fonts/NotoSans-Regular.ttf'),
  bold: readFileSync('packages/integrations/assets/report-fonts/NotoSans-Bold.ttf'),
};
