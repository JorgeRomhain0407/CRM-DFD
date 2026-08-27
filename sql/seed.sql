INSERT INTO public.productos (nombre, descripcion, precio, stock, activo)
VALUES
  ('Paracetamol 1 g 10 comprimidos', 'Analgésico y antipirético. Dispensación según criterio farmacéutico.', 4.95, 40, TRUE),
  ('Ibuprofeno 400 mg 20 comprimidos', 'Antiinflamatorio. Consultar en embarazo, úlcera o anticoagulantes.', 6.50, 25, TRUE),
  ('Vitamina D3 2000 UI 60 cápsulas', 'Complemento alimenticio. No sustituye una dieta equilibrada.', 12.90, 18, TRUE),
  ('Protector solar SPF50 50 ml', 'Fotoprotección facial. Uso tópico.', 15.75, 12, TRUE),
  ('Suero fisiológico 20 monodosis', 'Higiene nasal y ocular. Uso externo.', 3.20, 50, TRUE)
ON CONFLICT (nombre) DO NOTHING;
