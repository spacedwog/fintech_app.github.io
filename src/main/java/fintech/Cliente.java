package fintech;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

public class Cliente {

    private Integer idCliente;
    private String nomeCompleto;
    private String email;
    private String cpf;
    private String telefone;
    private final List<ProdutoFinanceiro> produtos;

    public Cliente() {
        System.out.println("Objetivo: inicializar um cliente sem dados cadastrais e com lista de produtos vazia.");
        this.produtos = new ArrayList<>();
    }

    public Cliente(Integer idCliente, String nomeCompleto, String email, String cpf, String telefone) {
        System.out.println("Objetivo: inicializar um cliente com dados cadastrais básicos.");
        this.idCliente = idCliente;
        this.nomeCompleto = nomeCompleto;
        this.email = email;
        this.cpf = cpf;
        this.telefone = telefone;
        this.produtos = new ArrayList<>();
    }

    public Integer getIdCliente() {
        System.out.println("Objetivo: retornar o identificador do cliente.");
        return idCliente;
    }

    public String getNomeCompleto() {
        System.out.println("Objetivo: retornar o nome completo do cliente.");
        return nomeCompleto;
    }

    public String getEmail() {
        System.out.println("Objetivo: retornar o e-mail do cliente.");
        return email;
    }

    public String getCpf() {
        System.out.println("Objetivo: retornar o CPF do cliente.");
        return cpf;
    }

    public String getTelefone() {
        System.out.println("Objetivo: retornar o telefone do cliente.");
        return telefone;
    }

    public void setTelefone(String telefone) {
        System.out.println("Objetivo: atualizar o telefone do cliente.");
        this.telefone = telefone;
    }

    public boolean cadastrarCliente() {
        System.out.println("Objetivo: validar os dados mínimos necessários para cadastro do cliente.");
        return idCliente != null
                && nomeCompleto != null
                && !nomeCompleto.isBlank()
                && email != null
                && email.contains("@")
                && cpf != null
                && cpf.matches("\\d{11}");
    }

    public void atualizarCadastro(String novoEmail, String novoTelefone) {
        System.out.println("Objetivo: atualizar e-mail e telefone do cliente quando os novos dados forem válidos.");
        if (novoEmail != null && !novoEmail.isBlank()) {
            this.email = novoEmail;
        }
        if (novoTelefone != null && !novoTelefone.isBlank()) {
            this.telefone = novoTelefone;
        }
    }

    public String consultarPerfil() {
        System.out.println("Objetivo: fornecer um resumo do perfil cadastral do cliente.");
        return "Cliente{id=" + idCliente + ", nome='" + nomeCompleto + "', email='" + email + "', produtos=" + produtos.size() + "}";
    }

    public void adicionarProduto(ProdutoFinanceiro produtoFinanceiro) {
        System.out.println("Objetivo: vincular um produto financeiro válido ao cliente.");
        if (produtoFinanceiro == null) {
            throw new IllegalArgumentException("Produto financeiro não pode ser nulo.");
        }
        if (produtos.contains(produtoFinanceiro)) {
            throw new IllegalArgumentException("Produto financeiro já vinculado ao cliente.");
        }
        produtoFinanceiro.vincularCliente(this);
        produtos.add(produtoFinanceiro);
    }

    public List<ProdutoFinanceiro> listarProdutos() {
        System.out.println("Objetivo: listar os produtos financeiros vinculados ao cliente de forma imutável.");
        return Collections.unmodifiableList(produtos);
    }
}
