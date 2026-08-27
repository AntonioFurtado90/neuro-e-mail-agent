# Neuro, agente de e-mail 
Esse projeto na verdade é a adpatação de um script no google appscript para tratar a minha caixa de e-mais diariamente, porém o script não está funcionando tão bem e eu estou com 4k de e-mails lotando a minha caixa de entrada.
## O que o claude deve fazer
- me ensinar a baixar o script via clasp e me indicar as extenções necessárias do vs code
- analisar o script e propor mudanças
- me explicar cada uma das mudanças antes de escreve-las
- criar o read-me do projeto
- Adicione arquivos de configuração como .clasp.json e tsconfig.json ao arquivo .claspignore para não enviá-los para o Google. 
##  Skills para o Claude Code.
- **Pair Programming:** você precisa primeiro e me dizer exatamente tudo o que vai fazer, ANTES de começar. Eu reviso, ajusto e, só quando estou satisfeito, deixo fazer. Fico olhando cada coisa que você faz e, no final, mando ajustar o que acho que faltou.
- **Test-Driven Development:** toda funcionalidade deve vir acompanhada de testes unitários. Toda correção de bug precisa de testes de regressão.
- **Continuous Integration:** Toda vez que termina de implementar, precisa rodar script de CI pra ver se nada quebrou em outro lugar. Mais do que isso: no branch master, só há commits com testes que passam.
- **Small Releases:** mesmo se eu acabar esquecendo de mandar comitar uma tarefa e mandar fazer outra, no fim, separe em 2 (ou mais) commits e descreva cada um da forma correta.
- **Coding Standard:** refatoramento continuo
## Diretrizes de Arquitetura e Engenharia de Software que devem ser seguidos
Este documento consolida as diretrizes arquiteturais da metodologia **The Twelve-Factor App** (formulada originalmente por Adam Wiggins no contexto do Heroku) combinada à análise técnica e conceitual apresentada por **Fabio Akita**. Adicionalmente, estabelece o **Framework Mínimo de Engenharia**, um conjunto de práticas operacionais voltadas à sustentabilidade, escalabilidade e manutenibilidade de aplicações corporativas modernas.
### 1. Contexto e Objetivos Arquiteturais**
A metodologia dos 12 Fatores define os padrões necessários para que sistemas web operem de forma nativa em nuvem (*cloud-native*), com alto nível de portabilidade, capacidade de dimensionamento elástico e desacoplamento de infraestrutura subjacente.
A adesão a esses padrões visa mitigar:
- Riscos de configurações divergentes entre ambientes (*environmental drift*).
- Falhas operacionais decorrentes de estados locais persistidos indevidamente (*state pollution*).
- Débito técnico associado a processos manuais de entrega e manutenção.
### 2. Os 12 Princípios Arquiteturais (*Twelve-Factor App*)
**Fator I: Base de Código (*Codebase*) Regra:** Uma base de código rastreada por controle de versão, múltiplos deploys.
- **Diretriz:** A totalidade do código-fonte deve residir em um único repositório sob controle de versão (Git) — seja em arquitetura de múltiplos repositórios ou monorepo.
- **Prática Técnica:** É estritamente vedado o uso de mecanismos manuais de transferência de arquivos (ex.: FTP/SFTP). Cada ambiente de execução (Desenvolvimento, *Staging*, Produção) corresponde a um *deploy* distinto a partir do mesmo código-base.
**Fator II: Dependências (*Dependencies*) Regra:** Declare e isole explicitamente as dependências da aplicação.
- **Diretriz:** A aplicação não deve presumir a existência implícita de pacotes, bibliotecas ou utilitários instalados no sistema operacional do *host*.
- **Prática Técnica:** Todas as dependências devem ser expressamente especificadas em arquivos de manifesto de dependências (ex.: `package.json`, `composer.json`, `requirements.txt`, `pom.xml`). O isolamento deve ser garantido por contêineres ou ambientes virtuais dedicados.
**Fator III: Configurações (*Config*) Regra:** Armazene as configurações no ambiente de execução.
- **Diretriz:** Parâmetros que variam conforme o ambiente (credenciais de banco de dados, chaves de API, portas de escuta) não podem constar fixos no código (*hardcoded*).
- **Prática Técnica:** A injeção de configurações deve ocorrer estritamente via variáveis de ambiente (`ENV`). Arquivos locais de configuração (ex.: `.env`) devem ser restritos ao desenvolvimento local e ignorados pelo controle de versão.
**Fator IV: Serviços de Apoio (*Backing Services*) Regra:** Trate serviços de apoio como recursos anexados via rede.
- **Diretriz:** Qualquer serviço auxiliar consumido pela aplicação (bancos de dados relacionais, caches em memória, sistemas de mensageria, gateways de e-mail) deve ser acessível unicamente por URI/conexão de rede.
- **Prática Técnica:** Proíbe-se a execução de serviços de suporte acoplados no mesmo processo ou contêiner da aplicação web. Deve ser possível substituir um serviço local por uma instância gerenciada na nuvem sem necessidade de refatoração do código.
**Fator V: Construção, Lançamento e Execução (*Build, Release, Run*) Regra:** Separe estritamente as etapas de compilação, parametrização e execução.
- **Diretriz:** O ciclo de entrega do software é subdividido em fases rigorosamente isoladas e unidirecionais:

    1. **Build:** Converte o repositório em um artefato imutável com suas dependências empacotadas.
    2. **Release:** Combina o artefato gerado na fase de *Build* com as variáveis de configuração específicas do ambiente de destino.
    3. **Run:** Instancia e executa o processo da aplicação a partir do *Release* gerado.
- **Prática Técnica:** Proíbe-se a edição direta de arquivos no servidor em tempo de execução. Todo *rollback* deve consistir na reativação de um identificador de *Release* prévio.
**Fator VI: Processos (*Processes / Stateless*)Regra:** Execute a aplicação como um ou mais processos que não guardam estado.
- **Diretriz:** Os processos da aplicação são efêmeros e desprovidos de estado (*stateless*). A persistência local em disco ou memória entre requisições não é garantida.
- **Prática Técnica:** Uploads de arquivos e estados de sessão devem ser delegados a serviços persistentes externos (ex.: *Object Storage* como AWS S3, bancos de dados ou clusters de cache como Redis).
**Fator VII: Vínculo de Portas (*Port Binding*)Regra:** Exporte serviços por meio de vinculação de portas de rede.
- **Diretriz:** A aplicação deve ser autossuficiente e expor sua interface de serviço (HTTP/gRPC/TCP) vinculando-se diretamente a uma porta atribuída pelo ambiente.
- **Prática Técnica:** Evita-se a injeção de servidores de aplicação complexos legados (como instâncias globais de Tomcat/Apache). O servidor HTTP roda embutido como dependência do próprio processo da aplicação.
**Fator VIII: Concorrência (*Concurrency*)Regra:** Dimensione a capacidade computacional por meio do modelo de processos.
- **Diretriz:** O escalonamento deve priorizar a expansão horizontal (*scale-out*), instanciando novos processos ou contêineres independentes, em vez de depender exclusivamente do aumento de recursos de uma única máquina (*scale-up*).
- **Prática Técnica:** O tráfego de entrada deve ser distribuído por balanceadores de carga (*load balancers*), segregando processos por função (ex.: processos web síncronos vs. *workers* de fila assíncronos).
**Fator IX: Descartabilidade (*Disposability*)Regra:** Maximize a robustez com inicialização rápida e término gracioso (*graceful shutdown*).
- **Diretriz:** Os processos devem inicializar em poucos segundos e responder prontamente a sinais de encerramento do sistema (`SIGTERM`).
- **Prática Técnica:** Durante o desligamento, o processo deve concluir a requisição HTTP em andamento ou reencaminhar mensagens da fila, prevenindo travamentos ou corrupção de dados. O ambiente deve ser preparado para que qualquer contêiner possa ser destruído e recriado imediatamente.
**Fator X: Paridade entre Ambientes (*Dev/Prod Parity*)Regra:** Mantenha os ambientes de desenvolvimento, homologação e produção o mais equivalentes possível.
- **Diretriz:** Reduza as discrepâncias temporais, de código e de ferramentas entre a estação de trabalho do desenvolvedor e o ambiente de produção.
- **Prática Técnica:** Não utilizar tecnologias distintas para simular serviços (ex.: usar SQLite em desenvolvimento e PostgreSQL em produção). Ferramentas de conteinerização (como Docker) devem assegurar uniformidade estrutural em todos os ciclos.
**Fator XI: Logs (*Logs as Event Streams*) Regra:** Trate logs como fluxos contínuos de eventos.
- **Diretriz:** A aplicação não deve gerenciar rotação, formatação em arquivo ou arquivamento de logs.
- **Prática Técnica:** A saída de eventos deve ser enviada diretamente para a saída padrão (`stdout` / `stderr`). A captura, processamento, indexação e armazenamento ficam a cargo de agentes e plataformas dedicadas de observabilidade.
**Fator XII: Processos Administrativos (*Admin Processes*) Regra:** Execute tarefas pontuais de gestão em contêineres idênticos e isolados.
- **Diretriz:** Tarefas esporádicas de manutenção, migração de esquema de banco de dados ou execução de scripts de suporte devem rodar em processos *one-off* descartáveis.
- **Prática Técnica:** Essas rotinas devem utilizar exatamente o mesmo *release* e as mesmas variáveis de ambiente de produção, sem concorrer por recursos no mesmo contêiner que atende requisições de usuários.
**3. O Framework Mínimo de Engenharia Ágil**
Para que os 12 Fatores sejam operacionalmente viáveis, é indispensável estabelecer uma disciplina contínua de entrega e validação de código. O Framework Mínimo consolida quatro regras operacionais mandatórias para equipes de desenvolvimento de alto desempenho:
| Pilar | Diretriz Operacional | Justificativa Técnica |
| --- | --- | --- |
| Cobertura de Testes Obrigatória | Todo Pull Request (PR) deve conter, no mínimo, testes automatizados (unitários e de regressão) | PRs sem testes devem ser rejeitados sumariamente. Garante que novos incrementos não quebrem funcionalidades legadas e estabelece barreira de segurança contínua contra regressões |
| Integração Frequente de Código | Desenvolvedores devem atualizar sua branch local diariamente (pull / rebase) integrando alterações e resolvendo conflitos em ciclos curtos. | Mitiga o risco de bifurcações complexas (merge hell) e assegura que a equipe trabalhe sobre um estado unificado da base de código |
| Integração Contínua (CI) Automatizada | Cada push dispara uma rotina em esteira de CI que constrói o artefato e executa a totalidade da suíte de testes automatizados. | A branch principal (main) permanece protegida e sempre em estado estável (deployable), bloqueando mesclagens em caso de falhas |
| Deploy Contínuo para Homologação (Staging) | Passando com sucesso pela esteira de CI, o deploy no ambiente de Staging (idêntico à produção) deve ocorrer de forma totalmente automatizada. | Possibilita validação imediata da funcionalidade em ambiente análogo ao produtivo, viabilizando o uso de Feature Flags para lançamentos controlados |
### 4. Considerações Finais
A adoção dos **12 Fatores** e do **Framework Mínimo** estabelece um alinhamento rigoroso entre engenharia de software e operações (*DevOps*). A arquitetura deixa de depender de garantias manuais e passa a operar sobre contêineres efêmeros, abstração de dependências e processos automatizados de integração e entrega contínua.